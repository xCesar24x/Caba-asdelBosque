const { createBucketClient } = require('@cosmicjs/sdk');
const { google } = require('googleapis');

// Vercel maneja las variables de entorno
const cosmicBucketSlug = process.env.COSMIC_BUCKET_SLUG;
const cosmicReadKey = process.env.COSMIC_READ_KEY;
const cosmicWriteKey = process.env.COSMIC_WRITE_KEY;

const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
// Se deben reemplazar los saltos de línea literales y limpiar comillas extras
let googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
if (googlePrivateKey.startsWith('"') && googlePrivateKey.endsWith('"')) {
  googlePrivateKey = googlePrivateKey.substring(1, googlePrivateKey.length - 1);
}
if (googlePrivateKey.startsWith("'") && googlePrivateKey.endsWith("'")) {
  googlePrivateKey = googlePrivateKey.substring(1, googlePrivateKey.length - 1);
}
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID;

// Inicializar Cosmic
const cosmic = createBucketClient({
  bucketSlug: cosmicBucketSlug,
  readKey: cosmicReadKey,
  writeKey: cosmicWriteKey,
});

// Inicializar Google Calendar
const jwtClient = new google.auth.JWT({
  email: googleClientEmail,
  key: googlePrivateKey,
  scopes: ['https://www.googleapis.com/auth/calendar']
});

const calendar = google.calendar({ version: 'v3', auth: jwtClient });

export default async function handler(req, res) {
  // Configuración básica de CORS y prevención de caché
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      let bookings = [];
      let events = [];
      let pricing = { basePrice: 25000, customPrices: {} };

      // 1. Obtener de Cosmic JS
      if (cosmicBucketSlug && cosmicReadKey) {
        try {
            const cosmicRes = await cosmic.objects.find({ type: 'bookings' }).props('metadata').limit(100);
            bookings = cosmicRes.objects || [];
        } catch (err) {
            console.error("Cosmic read error:", err);
        }

        try {
            const pricingRes = await cosmic.objects.find({
                type: 'bookings',
                slug: 'settings-pricing'
            }).props('metadata').limit(1);
            if (pricingRes.objects && pricingRes.objects.length > 0) {
                const meta = pricingRes.objects[0].metadata;
                pricing.basePrice = Number(meta.status) || 25000;
                if (meta.email) {
                    try {
                        pricing.customPrices = typeof meta.email === 'string' ? JSON.parse(meta.email) : meta.email;
                    } catch (e) {
                        pricing.customPrices = {};
                    }
                }
            }
        } catch (err) {
            console.error("Cosmic pricing read error:", err);
        }
      }

      // 2. Obtener de Google Calendar
      if (googleClientEmail && googlePrivateKey && googleCalendarId) {
          try {
            await jwtClient.authorize();
            const calendarRes = await calendar.events.list({
                auth: jwtClient,
                calendarId: googleCalendarId,
                timeMin: (new Date()).toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });
            events = calendarRes.data.items || [];
          } catch(err) {
            console.error("Calendar read error:", err);
          }
      }

      const blockedDates = [];

      const getDatesInRange = (startDate, endDate) => {
        const date = new Date(startDate.getTime());
        const dates = [];
        // Normalizar hora a 00:00 para evitar problemas de timezone
        date.setHours(0,0,0,0);
        endDate.setHours(0,0,0,0);
        
        while (date <= endDate) {
          dates.push(new Date(date).toISOString().split('T')[0]);
          date.setDate(date.getDate() + 1);
        }
        return dates;
      };

      // Procesar Cosmic JS (Asumiendo metadatos: check_in y check_out en formato YYYY-MM-DD)
      bookings.forEach(b => {
        if (b.metadata && b.metadata.check_in && b.metadata.check_out) {
           // En javascript 'YYYY-MM-DD' asume UTC. Usamos formato con T00:00:00
           const start = new Date(b.metadata.check_in + 'T00:00:00');
           const end = new Date(b.metadata.check_out + 'T00:00:00');
           blockedDates.push(...getDatesInRange(start, end));
        }
      });

      // Procesar Google Calendar
      events.forEach(e => {
        if (e.start && e.start.date && e.end && e.end.date) {
            const start = new Date(e.start.date + 'T00:00:00');
            const end = new Date(e.end.date + 'T00:00:00');
            end.setDate(end.getDate() - 1); // Calendar end dates son exclusivas
            blockedDates.push(...getDatesInRange(start, end));
        } else if (e.start && e.start.dateTime && e.end && e.end.dateTime) {
            const start = new Date(e.start.dateTime);
            const end = new Date(e.end.dateTime);
            
            // Si el evento termina en un día diferente al que empieza, restamos 1 día al final 
            // (porque es una reserva de varias noches y el último día es el Check-out libre).
            // Si empieza y termina el mismo día, es un bloqueo de un solo día (ej. mantenimiento) y debe bloquearse ese día completo.
            const startDateStr = e.start.dateTime.split('T')[0];
            const endDateStr = e.end.dateTime.split('T')[0];
            if (startDateStr !== endDateStr) {
                end.setDate(end.getDate() - 1);
            }
            
            blockedDates.push(...getDatesInRange(start, end));
        }
      });

      const uniqueBlockedDates = [...new Set(blockedDates)];
      if (req.query.debug === 'true') {
        return res.status(200).json({
          blockedDates: uniqueBlockedDates,
          pricing: pricing,
          rawEvents: events.map(e => ({
            summary: e.summary,
            start: e.start,
            end: e.end
          }))
        });
      }
      return res.status(200).json({ 
        blockedDates: uniqueBlockedDates,
        pricing: pricing
      });

    } catch (error) {
      console.error('Error global fetching bookings:', error);
      return res.status(500).json({ error: 'Error al obtener fechas reservadas' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, whatsapp, email, guests, checkIn, checkOut, status } = req.body;

      if (!name || !whatsapp || !email || !checkIn || !checkOut) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
      }

      let calendarEventId = null;

      // 1. Guardar en Google Calendar primero para obtener el Event ID
      if (googleClientEmail && googlePrivateKey && googleCalendarId) {
          try {
              await jwtClient.authorize();
              const endDate = new Date(checkOut + 'T00:00:00');
              endDate.setDate(endDate.getDate() + 1);
              const googleEndDateStr = endDate.toISOString().split('T')[0];

              const calendarRes = await calendar.events.insert({
                auth: jwtClient,
                calendarId: googleCalendarId,
                resource: {
                  summary: name.toUpperCase().startsWith('BLOQUEO') ? name : `Reserva: ${name}`,
                  description: `Huéspedes: ${guests}\nWhatsApp: ${whatsapp}\nEmail: ${email}`,
                  start: { date: checkIn },
                  end: { date: googleEndDateStr },
                }
              });
              if (calendarRes && calendarRes.data && calendarRes.data.id) {
                calendarEventId = calendarRes.data.id;
              }
          } catch(err) {
            console.error("Calendar write error:", err);
          }
      }

      // 2. Guardar en Cosmic JS incluyendo el status y calendar_event_id
      if (cosmicBucketSlug && cosmicWriteKey) {
        try {
            await cosmic.objects.insertOne({
                title: name.toUpperCase().startsWith('BLOQUEO') ? name : `Reserva - ${name}`,
                type: 'bookings',
                metadata: {
                    name,
                    whatsapp,
                    email,
                    guests: Number(guests),
                    check_in: checkIn,
                    check_out: checkOut,
                    calendar_event_id: calendarEventId,
                    status: status || 'pending'
                }
            });
        } catch(err) {
            console.error("Cosmic write error:", err);
            return res.status(500).json({ error: 'Cosmic write error: ' + err.message });
        }
      }

      return res.status(200).json({ message: 'Reserva procesada exitosamente' });

    } catch (error) {
      console.error('Error POST booking:', error);
      return res.status(500).json({ error: 'Error interno al procesar la reserva: ' + error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
