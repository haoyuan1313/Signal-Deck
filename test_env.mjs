import express from 'express';
const app = express();
app.get('/', (req, res) => res.json({ key: process.env.GEMINI_API_KEY }));
app.listen(3001, () => console.log('Listening on 3001'));
