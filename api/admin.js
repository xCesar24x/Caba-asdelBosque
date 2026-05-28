const { createBucketClient } = require('@cosmicjs/sdk');
const { google } = require('googleapis');

// Vercel maneja las variables de entorno
const cosmicBucketSlug = process.env.COSMIC_BUCKET_SLUG;
const cosmicReadKey = process.env.COSMIC_READ_KEY;
const cosmicWriteKey = process.env.COSMIC_WRITE_KEY;

const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
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

  if (req.method === 'GET' && req.query && req.query.type === 'pricing') {
    try {
      let pricing = { basePrice: 25000, customPrices: {} };
      if (cosmicBucketSlug && cosmicReadKey) {
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
      return res.status(200).json(pricing);
    } catch (error) {
      console.error('Error in Admin GET pricing:', error);
      return res.status(500).json({ error: 'Error al obtener configuración de precios' });
    }
  }

  // --- LISTAR RESERVAS ---
  if (req.method === 'GET') {
    try {
      if (!cosmicBucketSlug || !cosmicReadKey) {
        return res.status(500).json({ error: 'Configuración de Cosmic JS incompleta' });
      }

      // Obtener todas las reservas de Cosmic JS
      let cosmicRes = { objects: [] };
      try {
        cosmicRes = await cosmic.objects.find({ type: 'bookings' }).props(['id', 'title', 'metadata', 'created_at']).limit(200);
      } catch (e) {
        if (e.message && e.message.includes('No objects found')) {
          // This is expected if the bucket is empty
          cosmicRes = { objects: [] };
        } else {
          console.error('Error fetching bookings in GET:', e);
          return res.status(500).json({ error: 'Error from Cosmic JS: ' + e.message });
        }
      }

      const bookings = cosmicRes.objects || [];

      // Mapear de forma ultra-segura filtrando objetos sin metadatos y ordenar por fecha de check-in (las más próximas primero)
      const mappedBookings = bookings
        .filter(b => b.metadata && b.metadata.check_in && b.metadata.check_out)
        .map(b => ({
          id: b.id,
          title: b.title,
          name: b.metadata.name || 'Huésped Anónimo',
          whatsapp: b.metadata.whatsapp || '',
          email: b.metadata.email || '',
          guests: b.metadata.guests || 2,
          checkIn: b.metadata.check_in,
          checkOut: b.metadata.check_out,
          status: b.metadata.status || 'pending',
          calendarEventId: b.metadata.calendar_event_id || null,
          createdAt: b.created_at
        })).sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));

      return res.status(200).json({ bookings: mappedBookings });

    } catch (error) {
      console.error('Error in Admin GET:', error);
      return res.status(500).json({ error: 'Error al obtener la lista de reservas' });
    }
  }

  // --- MODIFICAR O BORRAR RESERVA ---
  if (req.method === 'POST') {
    try {
      const { action, id } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'Falta el parámetro requerido: action' });
      }
      
      if (action !== 'delete_all' && action !== 'update_pricing' && !id) {
        return res.status(400).json({ error: 'Falta el parámetro requerido: id' });
      }

      // --- ACCIÓN: ACTUALIZAR PRECIOS ---
      if (action === 'update_pricing') {
        const { basePrice, customPrices } = req.body;
        if (!basePrice) {
          return res.status(400).json({ error: 'Falta el precio base' });
        }
        
        const customPricesStr = typeof customPrices === 'object' ? JSON.stringify(customPrices) : (customPrices || '{}');

        let pricingId = null;
        try {
          const pricingRes = await cosmic.objects.find({
            type: 'bookings',
            slug: 'settings-pricing'
          }).props('id').limit(1);
          if (pricingRes.objects && pricingRes.objects.length > 0) {
            pricingId = pricingRes.objects[0].id;
          }
        } catch(e) {
          console.log("No existing pricing object, will insert a new one.");
        }

        if (pricingId) {
          await cosmic.objects.updateOne(pricingId, {
            metadata: {
              name: 'SETTINGS_PRICING',
              email: customPricesStr,
              status: String(basePrice),
              whatsapp: 'N/A',
              guests: 1,
              check_in: '2000-01-01',
              check_out: '2000-01-01'
            }
          });
        } else {
          await cosmic.objects.insertOne({
            title: 'Pricing Settings',
            type: 'bookings',
            slug: 'settings-pricing',
            metadata: {
              name: 'SETTINGS_PRICING',
              email: customPricesStr,
              status: String(basePrice),
              whatsapp: 'N/A',
              guests: 1,
              check_in: '2000-01-01',
              check_out: '2000-01-01'
            }
          });
        }

        return res.status(200).json({ message: 'Precios actualizados exitosamente' });
      }

      // --- ACCIÓN: ELIMINAR TODAS LAS RESERVAS ---
      if (action === 'delete_all') {
        let count = 0;
        try {
          let cosmicRes;
          try {
            cosmicRes = await cosmic.objects.find({ type: 'bookings' }).props(['id', 'metadata']).limit(200);
          } catch(err) {
            if (err.message && err.message.includes('No objects found')) {
              cosmicRes = { objects: [] };
            } else {
              throw err;
            }
          }
          
          const bookingsToDelete = cosmicRes.objects || [];
          for (const b of bookingsToDelete) {
            try {
              await cosmic.objects.deleteOne(b.id);
              count++;
            } catch (err) {
              console.error('Error deleting booking:', err);
            }
          }
          return res.status(200).json({ message: `Se eliminaron ${count} reservas de la base de datos` });
        } catch(e) {
          console.error('Error fetching bookings for delete_all:', e);
          return res.status(500).json({ error: 'Error fetching bookings for delete_all: ' + e.message });
        }
      }

      // 1. Obtener la reserva actual de Cosmic
      let booking;
      try {
        const cosmicRes = await cosmic.objects.find({ type: 'bookings', id: id }).props('metadata').limit(1);
        if (cosmicRes.objects && cosmicRes.objects.length > 0) {
          booking = cosmicRes.objects[0];
        } else {
          return res.status(404).json({ error: 'Reserva no encontrada' });
        }
      } catch(e) {
        console.error('Error fetching booking by id:', e);
        return res.status(404).json({ error: 'Error al buscar reserva: ' + e.message });
      }

      // --- ACCIÓN: CONFIRMAR RESERVA ---
      if (action === 'confirm') {
        const calendarEventId = booking.metadata && booking.metadata.calendar_event_id ? booking.metadata.calendar_event_id : null;
        
        // 1. Confirmar en Google Calendar
        if (calendarEventId && googleClientEmail && googlePrivateKey && googleCalendarId) {
           try {
             await jwtClient.authorize();
             await calendar.events.patch({
               auth: jwtClient,
               calendarId: googleCalendarId,
               eventId: calendarEventId,
               resource: {
                 colorId: '2'
               }
             });
           } catch(e) {
             console.error('Error actualizando Google Calendar al confirmar:', e);
           }
        }

        // 2. Actualizar estado en Cosmic JS a "confirmed"
        try {
          await cosmic.objects.updateOne(id, {
            metadata: {
              ...booking.metadata,
              status: 'confirmed'
            }
          });
        } catch(e) {
          console.error('Error actualizando Cosmic JS al confirmar:', e);
          return res.status(500).json({ error: 'Error al actualizar base de datos: ' + e.message });
        }

        return res.status(200).json({ message: 'Reserva confirmada exitosamente' });
      }

      // --- ACCIÓN: ELIMINAR RESERVA ---
      if (action === 'delete') {
        const calendarEventId = booking.metadata.calendar_event_id;

        // A. Eliminar de Google Calendar si tiene un ID de evento asociado
        if (calendarEventId && googleClientEmail && googlePrivateKey && googleCalendarId) {
          try {
            await jwtClient.authorize();
            await calendar.events.delete({
              calendarId: googleCalendarId,
              eventId: calendarEventId
            });
            console.log(`Google Calendar event ${calendarEventId} deleted successfully.`);
          } catch (calErr) {
            console.error('Error deleting from Google Calendar (continuing deletion process):', calErr);
          }
        }

        // B. Eliminar de Cosmic JS
        await cosmic.objects.deleteOne(id);

        return res.status(200).json({ message: 'Reserva eliminada y fechas liberadas exitosamente' });
      }

      return res.status(400).json({ error: 'Acción inválida. Use "confirm", "delete" o "delete_all"' });

    } catch (error) {
      console.error('Error in Admin POST action:', error);
      return res.status(500).json({ error: 'Error interno al procesar la acción' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
