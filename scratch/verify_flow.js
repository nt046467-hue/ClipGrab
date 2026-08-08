const fetch = require('node-fetch');
const API_URL = process.env.API_URL || 'http://127.0.0.1:8080';

(async () => {
  try {
    console.log('Resolving metadata...');
    const resolveResp = await fetch(`${API_URL}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://vimeo.com/76979871' })
    });
    const metadata = await resolveResp.json();
    console.log('Metadata:', JSON.stringify(metadata, null, 2));
    if (!metadata.title) {
      console.error('Metadata missing title, aborting');
      process.exit(1);
    }
    const format = metadata.formats.find(f => f.type === 'video') || metadata.formats[0];
    console.log('Choosing format:', format.id);
    const downloadResp = await fetch(`${API_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://vimeo.com/76979871',
        formatId: format.id,
        type: format.type,
        title: metadata.title,
        platform: metadata.platform
      })
    });
    const { jobId } = await downloadResp.json();
    console.log('Job ID:', jobId);
    const poll = async () => {
      const statusResp = await fetch(`${API_URL}/api/status/${jobId}`);
      const status = await statusResp.json();
      console.log('Status:', status.status, 'progress', status.progress);
      if (status.status === 'completed') {
        console.log('Download URL:', status.result.downloadUrl);
        clearInterval(interval);
      } else if (status.status === 'failed') {
        console.error('Job failed');
        clearInterval(interval);
      }
    };
    const interval = setInterval(poll, 2000);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
