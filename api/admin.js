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
  // Configuración básica de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // --- LISTAR RESERVAS ---
  if (req.method === 'GET') {
    try {
      if (!cosmicBucketSlug || !cosmicReadKey) {
        return res.status(500).json({ error: 'Configuración de Cosmic JS incompleta' });
      }

      // Obtener todas las reservas de Cosmic JS
      const cosmicRes = await cosmic.objects.find({ type: 'bookings' }).limit(200);

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

      if (!id || !action) {
        return res.status(400).json({ error: 'Faltan parámetros requeridos: id o action' });
      }

      // 1. Obtener la reserva actual de Cosmic
      let booking;
      try {
        booking = await cosmic.objects.findOne({ id }).props('metadata');
      } catch (err) {
        return res.status(404).json({ error: 'No se encontró la reserva especificada' });
      }

      // --- ACCIÓN: CONFIRMAR RESERVA ---
      if (action === 'confirm') {
        const updatedMetadata = {
          ...booking.metadata,
          status: 'confirmed'
        };

        await cosmic.objects.updateOne(id, {
          metadata: updatedMetadata
        });

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

      return res.status(400).json({ error: 'Acción inválida. Use "confirm" o "delete"' });

    } catch (error) {
      console.error('Error in Admin POST action:', error);
      return res.status(500).json({ error: 'Error interno al procesar la acción' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
