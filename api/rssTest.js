// AXIS — Reddit RSS Test

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const results = {};

  const feeds = [
    { name: 'r/freelance', url: 'https://www.reddit.com/r/freelance/new/.rss' },
    { name: 'r/freelancers', url: 'https://www.reddit.com/r/freelancers/new/.rss' }
  ];

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'AXIS-Intelligence/1.0',
          'Accept': 'application/rss+xml, application/xml, text/xml'
        }
      });

      const status = response.status;
      const text = await response.text();

      // Extract titles and dates from RSS XML
      const titles = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)]
        .map(m => m[1])
        .filter(t => t && !t.includes('reddit'))
        .slice(0, 5);

      const dates = [...text.matchAll(/<published>(.*?)<\/published>/g)]
        .map(m => m[1])
        .slice(0, 5);

      results[feed.name] = {
        status,
        titles,
        dates,
        rawPreview: text.slice(0, 300)
      };

    } catch (err) {
      results[feed.name] = { error: err.message };
    }
  }

  res.status(200).json(results);
}
