const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MONGO_URI = process.env.MONGO_URI || '';

let db;
let scheduleData = {};

async function connectDB() {
  if (!MONGO_URI) {
    console.log('No MONGO_URI set, using in-memory storage');
    return;
  }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('onja');
    console.log('Connected to MongoDB');

    // Load all schedules from DB
    const docs = await db.collection('schedules').find({}).toArray();
    docs.forEach(doc => {
      scheduleData[doc.dateKey] = doc.entries;
    });
    console.log(`Loaded ${docs.length} days from DB`);
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
  }
}

async function saveToDb(dateKey) {
  if (!db) return;
  try {
    if (scheduleData[dateKey] && scheduleData[dateKey].length > 0) {
      await db.collection('schedules').updateOne(
        { dateKey },
        { $set: { dateKey, entries: scheduleData[dateKey] } },
        { upsert: true }
      );
    } else {
      await db.collection('schedules').deleteOne({ dateKey });
    }
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

app.use(express.static('public'));
app.use(express.json());

app.post('/api/login', (req, res) => {
  const { id, pw } = req.body;
  if (id === '온자' && pw === '온자') {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
  }
});

app.get('/api/schedules', (req, res) => {
  res.json(scheduleData);
});

io.on('connection', (socket) => {
  console.log('User connected');
  socket.emit('init', scheduleData);

  socket.on('updateSchedule', (data) => {
    const { dateKey, text, author, time } = data;
    if (text.trim() === '') return;

    if (!scheduleData[dateKey]) {
      scheduleData[dateKey] = [];
    }

    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    scheduleData[dateKey].push({ id, text, author, time: time || 'allday' });

    saveToDb(dateKey);
    io.emit('scheduleUpdated', { dateKey, entries: scheduleData[dateKey] });
  });

  socket.on('deleteEntry', (data) => {
    const { dateKey, entryId } = data;
    if (scheduleData[dateKey]) {
      scheduleData[dateKey] = scheduleData[dateKey].filter(e => e.id !== entryId);
      if (scheduleData[dateKey].length === 0) {
        delete scheduleData[dateKey];
      }
      saveToDb(dateKey);
      io.emit('scheduleUpdated', { dateKey, entries: scheduleData[dateKey] || [] });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
});
