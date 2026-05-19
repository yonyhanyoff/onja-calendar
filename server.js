const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_FILE = path.join(__dirname, 'data.json');

// Load or initialize schedule data
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  return {};
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let scheduleData = loadData();

app.use(express.static('public'));
app.use(express.json());

// Login endpoint
app.post('/api/login', (req, res) => {
  const { id, pw } = req.body;
  if (id === '온자' && pw === '온자') {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
  }
});

// Get all schedule data
app.get('/api/schedules', (req, res) => {
  res.json(scheduleData);
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('User connected');

  // Send current data to newly connected user
  socket.emit('init', scheduleData);

  // Handle schedule update — always add new entry
  socket.on('updateSchedule', (data) => {
    const { dateKey, text, author } = data;
    if (text.trim() === '') return;

    if (!scheduleData[dateKey]) {
      scheduleData[dateKey] = [];
    }

    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    scheduleData[dateKey].push({ id, text, author });

    saveData(scheduleData);
    io.emit('scheduleUpdated', { dateKey, entries: scheduleData[dateKey] });
  });

  // Handle delete specific entry by id
  socket.on('deleteEntry', (data) => {
    const { dateKey, entryId } = data;
    if (scheduleData[dateKey]) {
      scheduleData[dateKey] = scheduleData[dateKey].filter(e => e.id !== entryId);
      if (scheduleData[dateKey].length === 0) {
        delete scheduleData[dateKey];
      }
      saveData(scheduleData);
      io.emit('scheduleUpdated', { dateKey, entries: scheduleData[dateKey] || [] });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
