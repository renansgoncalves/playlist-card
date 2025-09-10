require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const { Vibrant } = require('node-vibrant/node');

const app = express();
const PORT = 3001;

app.use(cors());

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Pega token de acesso do Spotify
const getSpotifyToken = async () => {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');

  const response = await axios.post('https://accounts.spotify.com/api/token', params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
    }
  });

  return response.data.access_token;
};


function darkenHexColor(hex, percent) {
  // remove o #
  const cleanHex = hex.replace('#', '');
  const num = parseInt(cleanHex, 16);

  let r = (num >> 16) & 0xFF;
  let g = (num >> 8) & 0xFF;
  let b = num & 0xFF;

  // diminui a cor em 'percent'%
  r = Math.max(0, Math.min(255, Math.floor(r * (1 - percent))));
  g = Math.max(0, Math.min(255, Math.floor(g * (1 - percent))));
  b = Math.max(0, Math.min(255, Math.floor(b * (1 - percent))));

  // converte de volta para hex
  const newHex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return newHex;
}


// Gera a imagem do card
const generateImage = async (playlistData) => {
  let templateHtml = await fs.readFile('./template.html', 'utf8');

  // Extrai cor dominante da capa
  let vibrantColor = '#121212'; // fallback
  try {
    const playlistCoverUrl = playlistData.images[0]?.url || '';
    const palette = await Vibrant.from(playlistCoverUrl).getPalette();
    if (palette.Vibrant) {
      vibrantColor = darkenHexColor(palette.Vibrant.hex, 0.15);
    }
  } catch (err) {
    console.error('Erro ao extrair cor da capa:', err);
    vibrantColor = '#121212';
  }

  // Divide músicas em colunas
  const tracks = playlistData.tracks.items.slice(0, 32).map(item => {
    const track = item.track;
    if (!track) return null;
    return {
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      cover: track.album.images[0]?.url || ''
    };
  }).filter(Boolean);

  const total = tracks.length;
  const col1Limit = Math.ceil(total / 2);
  const col1Tracks = tracks.slice(0, col1Limit);
  const col2Tracks = tracks.slice(col1Limit);

  const renderTracks = (arr) => arr.map(t => `
    <div class="track-item">
      <img src="${t.cover}" alt="${t.title}">
      <div class="track-info">
        <div class="track-title">${t.title}</div>
        <div class="track-artist">${t.artist}</div>
      </div>
    </div>
  `).join('');


  const profilePath = './assets/profile.png';
  const profileBuffer = await fs.readFile(profilePath);
  const profileBase64 = `data:image/png;base64,${profileBuffer.toString('base64')}`;


  templateHtml = templateHtml
  .replace('{{playlistName}}', playlistData.name)
  .replace('{{playlistOwner}}', playlistData.owner.display_name)
  .replace('{{playlistCoverUrl}}', playlistData.images[0].url)
  .replace('{{col1}}', renderTracks(col1Tracks))
  .replace('{{col2}}', renderTracks(col2Tracks))
  .replace('<img id="profileImg" src=""/>', `<img id="profileImg" src="${profileBase64}"/>`)
  .replace('<body style="background-color: #121212;">', `<body style="background-color: ${darkenHexColor(vibrantColor, 0.55)};">`)
  .replace('<div id="card-container" style="background-color: #282828;">', `<div id="card-container" style="background-image: linear-gradient(to bottom, ${vibrantColor} 0%, ${darkenHexColor(vibrantColor, 0.4)} 35%, ${darkenHexColor(vibrantColor, 0.5)} 65%, ${darkenHexColor(vibrantColor, 0.7)} 100%);">`)

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 2160, height: 5120, deviceScaleFactor: 1 });
  await page.setContent(templateHtml, { waitUntil: 'networkidle0' });

  const cardElement = await page.$('#card-container');
  const imageBuffer = await page.screenshot({ type: 'png' });

  await browser.close();
  return imageBuffer;
};


app.get('/api/playlist/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const token = await getSpotifyToken();

    const playlistResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const imageBuffer = await generateImage(playlistResponse.data);

    const imageBase64 = imageBuffer.toString('base64');

    res.send(`
      <html>
        <head>
          <title>Spotify Playlist</title>
          <style>
            body { font-family: sans-serif; background: #f2f2f2; padding: 20px; display: flex; justify-content: center; align-items: flex-start; }
            img { max-width: 800px; }
          </style>
        </head>
        <body>
          <div><img src="data:image/png;base64,${imageBase64}" alt="Capa da Playlist" /></div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Erro:', error.response ? error.response.data : error.message);
    res.status(500).send('Falha ao processar a playlist.');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});