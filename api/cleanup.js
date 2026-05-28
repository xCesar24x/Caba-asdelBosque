const { createBucketClient } = require('@cosmicjs/sdk');

const cosmicBucketSlug = process.env.COSMIC_BUCKET_SLUG;
const cosmicReadKey = process.env.COSMIC_READ_KEY;
const cosmicWriteKey = process.env.COSMIC_WRITE_KEY;

const cosmic = createBucketClient({
  bucketSlug: cosmicBucketSlug,
  readKey: cosmicReadKey,
  writeKey: cosmicWriteKey,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Buscar las reservas
    const cosmicRes = await cosmic.objects.find({ type: 'bookings' }).limit(100);
    const bookings = cosmicRes.objects || [];

    if (bookings.length === 0) {
      return res.status(200).json({ message: 'La base de datos de Cosmic JS ya está vacía.' });
    }

    let deletedCount = 0;
    for (const b of bookings) {
      await cosmic.objects.deleteOne(b.id);
      deletedCount++;
    }

    return res.status(200).json({ 
      message: `¡Limpieza completada! Se eliminaron ${deletedCount} registros de reservas de Cosmic JS.` 
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    return res.status(500).json({ error: error.message });
  }
}
