require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const fs = require('fs/promises');

const app = express();
const PORT = 3001;

app.use(cors());

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const getSpotifyToken = async () => {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    const response = await axios.post('https://accounts.spotify.com/api/token', params, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
        }
    });
    return response.data.access_token;
};


const generateImage = async (playlistData) => {
    let templateHtml = await fs.readFile('./template.html', 'utf8');

    const tracksHtml = playlistData.tracks.items.slice(0, 32).map(item => {
        const track = item.track;
        if (!track) return '';
        const coverUrl = track.album.images[0]?.url || '';
        const title = track.name;
        const artist = track.artists.map(a => a.name).join(', ');
        
        return `
            <div class="track-item">
                <img src="${coverUrl}" alt="${title}">
                <div class="track-info">
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${artist}</div>
                </div>
            </div>
        `;
    }).join('');

    templateHtml = templateHtml.replace('{{playlistName}}', playlistData.name);
    templateHtml = templateHtml.replace('{{playlistCoverUrl}}', playlistData.images[0].url);
    templateHtml = templateHtml.replace('{{tracks}}', tracksHtml);
    
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
    
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });

    const cardElement = await page.$('#card-container');
    const imageBuffer = await cardElement.screenshot({ type: 'png' });

    await browser.close();

    return imageBuffer;
};


app.get('/api/playlist/:playlistId', async (req, res) => {
    try {
        const { playlistId } = req.params;
        const token = await getSpotifyToken();

        console.log(`Buscando dados para a playlist: ${playlistId}`);
        const playlistResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('Gerando imagem da playlist...');
        const imageBuffer = await generateImage(playlistResponse.data);

        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);

    } catch (error) {
        console.error('Erro:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Falha ao processar a playlist.' });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});