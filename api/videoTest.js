// AXIS — Video Pipeline Tester
// Visit /api/videoTest to test JSON2Video render without touching Telegram
// Returns full API response so you can debug before deploying to AXIS

export const config = {
  runtime: 'nodejs',
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const apiKey = process.env.JSON2VIDEO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'JSON2VIDEO_API_KEY not set' });
  }

  // ━━━ Step 1 — Submit render ━━━
  const payload = {
    resolution: 'mobile',
    quality: 'high',
    scenes: [
      {
        duration: -1,
        'background-color': '#0a0a0a',
        elements: [
          {
            type: 'voice',
            text: 'FORGE. Built from a phone in Nigeria. Your AI freelance coach that never sleeps. No team. No office. Just results.',
            voice: 'Adam',
            model: 'elevenlabs',
            duration: -1
          },
          {
            type: 'text',
            text: 'FORGE',
            style: '001',
            duration: -1
          },
          {
            type: 'text',
            text: 'Built from a phone. Built for you.',
            style: '002',
            duration: -1
          }
        ]
      }
    ]
  };

  let submitData;
  try {
    const submitRes = await fetch('https://api.json2video.com/v2/movies', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    submitData = await submitRes.json();

    if (!submitRes.ok || !submitData?.project) {
      return res.status(200).json({
        step: 'submit',
        status: 'failed',
        response: submitData,
        payload_sent: payload
      });
    }
  } catch (err) {
    return res.status(200).json({
      step: 'submit',
      status: 'fetch_error',
      error: err.message
    });
  }

  const projectId = submitData.project;

  // ━━━ Step 2 — Poll up to 50 seconds ━━━
  let finalStatus = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 5000));

    try {
      const pollRes = await fetch(`https://api.json2video.com/v2/movies?project=${projectId}`, {
        headers: { 'x-api-key': apiKey }
      });
      const pollData = await pollRes.json();
      const status = pollData?.movie?.status;

      if (status === 'done') {
        return res.status(200).json({
          step: 'complete',
          status: 'success',
          project: projectId,
          video_url: pollData.movie.url,
          credits_remaining: pollData.remaining_quota,
          message: 'Open video_url in browser to preview'
        });
      }

      if (status === 'error') {
        return res.status(200).json({
          step: 'render',
          status: 'error',
          project: projectId,
          response: pollData
        });
      }

      finalStatus = status;
    } catch (err) {
      return res.status(200).json({
        step: 'poll',
        status: 'fetch_error',
        project: projectId,
        error: err.message
      });
    }
  }

  // Timed out — return project ID for manual check
  return res.status(200).json({
    step: 'timeout',
    status: 'still_rendering',
    project: projectId,
    last_status: finalStatus,
    manual_check: `https://api.json2video.com/v2/movies?project=${projectId}`,
    message: 'Render taking longer than 50s. Use manual_check URL with your API key to poll.'
  });
}
