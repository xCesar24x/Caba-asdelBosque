const { createBucketClient } = require('@cosmicjs/sdk');
const { google } = require('googleapis');

// Vercel maneja las variables de entorno
const cosmicBucketSlug = process.env.COSMIC_BUCKET_SLUG;
const cosmicReadKey = process.env.COSMIC_READ_KEY;
const cosmicWriteKey = process.env.COSMIC_WRITE_KEY;

const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
// Se deben reemplazar los saltos de línea literales
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const googleCalendarId = process.env.GOOGLE_CALENDAR_ID;

// Inicializar Cosmic
const cosmic = createBucketClient({
  bucketSlug: cosmicBucketSlug,
  readKey: cosmicReadKey,
  writeKey: cosmicWriteKey,
});

// Inicializar Google Calendar
const jwtClient = new google.auth.JWT(
  googleClientEmail,
  null,
  googlePrivateKey,
  ['https://www.googleapis.com/auth/calendar']
);

const calendar = google.calendar({ version: 'v3', auth: jwtClient });

export default async function handler(req, res) {
  // Configuración básica de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      let bookings = [];
      let events = [];

      // 1. Obtener de Cosmic JS
      if (cosmicBucketSlug && cosmicReadKey) {
        try {
            const cosmicRes = await cosmic.objects.find({ type: 'bookings' }).props('metadata').limit(100);
            bookings = cosmicRes.objects || [];
        } catch (err) {
            console.error("Cosmic read error:", err);
        }
      }

      // 2. Obtener de Google Calendar
      if (googleClientEmail && googlePrivateKey && googleCalendarId) {
          try {
            const calendarRes = await calendar.events.list({
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
            blockedDates.push(...getDatesInRange(start, end));
        }
      });

      const uniqueBlockedDates = [...new Set(blockedDates)];
      return res.status(200).json({ blockedDates: uniqueBlockedDates });

    } catch (error) {
      console.error('Error global fetching bookings:', error);
      return res.status(500).json({ error: 'Error al obtener fechas reservadas' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, whatsapp, email, guests, checkIn, checkOut } = req.body;

      if (!name || !whatsapp || !email || !checkIn || !checkOut) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
      }

      // 1. Guardar en Cosmic JS
      if (cosmicBucketSlug && cosmicWriteKey) {
        try {
            await cosmic.objects.insertOne({
                title: `Reserva - ${name}`,
                type: 'bookings',
                metadata: {
                    name,
                    whatsapp,
                    email,
                    guests: Number(guests),
                    check_in: checkIn,
                    check_out: checkOut
                }
            });
        } catch(err) {
            console.error("Cosmic write error:", err);
            // Dependiendo de requerimientos, podríamos fallar o continuar
        }
      }

      // 2. Guardar en Google Calendar
      if (googleClientEmail && googlePrivateKey && googleCalendarId) {
          try {
              const endDate = new Date(checkOut + 'T00:00:00');
              endDate.setDate(endDate.getDate() + 1);
              const googleEndDateStr = endDate.toISOString().split('T')[0];

              await calendar.events.insert({
                calendarId: googleCalendarId,
                resource: {
                  summary: `Reserva: ${name}`,
                  description: `Huéspedes: ${guests}\nWhatsApp: ${whatsapp}\nEmail: ${email}`,
                  start: { date: checkIn },
                  end: { date: googleEndDateStr },
                }
              });
          } catch(err) {
            console.error("Calendar write error:", err);
          }
      }

      return res.status(200).json({ message: 'Reserva procesada exitosamente' });

    } catch (error) {
      console.error('Error POST booking:', error);
      return res.status(500).json({ error: 'Error interno al procesar la reserva' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
