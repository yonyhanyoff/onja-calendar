const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_FILE = path.join(__dirname, 'data.json');
const GCAL_FILE = path.join(__dirname, 'gcal-urls.json');

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

function loadGcalUrls() {
  try {
    if (fs.existsSync(GCAL_FILE)) {
      return JSON.parse(fs.readFileSync(GCAL_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveGcalUrls(urls) {
  fs.writeFileSync(GCAL_FILE, JSON.stringify(urls, null, 2), 'utf8');
}

// Simple iCal parser
function parseICS(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    let summary = '';
    let dtstart = '';

    const lines = block.replace(/\r\n /g, '').split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('SUMMARY')) {
        summary = line.replace(/^SUMMARY[^:]*:/, '');
      } else if (line.startsWith('DTSTART')) {
        dtstart = line.replace(/^DTSTART[^:]*:/, '').replace(/T.*$/, '');
      }
    }

    if (dtstart && summary) {
      // Convert 20260519 to 2026-05-19
      const dateKey = dtstart.length >= 8
        ? `${dtstart.slice(0,4)}-${dtstart.slice(4,6)}-${dtstart.slice(6,8)}`
        : dtstart;
      events.push({ dateKey, text: summary });
    }
  }
  return events;
}

let scheduleData = loadData();
let gcalUrls = loadGcalUrls();
let gcalCache = {}; // { dateKey: [ {text, author:'Google'} ] }

// Fetch Google Calendar events
async function fetchGcalEvents() {
  const allEvents = {};
  for (const entry of gcalUrls) {
    try {
      const res = await fetch(entry.url);
      const text = await res.text();
      const events = parseICS(text);
      for (const ev of events) {
        if (!allEvents[ev.dateKey]) allEvents[ev.dateKey] = [];
        allEvents[ev.dateKey].push({ text: ev.text, author: entry.label || 'Google', isGcal: true });
      }
    } catch (e) {
      console.error('Failed to fetch gcal:', entry.url, e.message);
    }
  }
  gcalCache = allEvents;
  console.log(`Fetched ${Object.keys(allEvents).length} days from Google Calendar`);
}

// Refresh every 10 minutes
if (gcalUrls.length > 0) fetchGcalEvents();
setInterval(() => { if (gcalUrls.length > 0) fetchGcalEvents(); }, 10 * 60 * 1000);

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

// Get all schedule data (merged with gcal)
app.get('/api/schedules', (req, res) => {
  res.json(scheduleData);
});

// Get Google Calendar events
app.get('/api/gcal-events', (req, res) => {
  res.json(gcalCache);
});

// Manage Google Calendar URLs
app.get('/api/gcal-urls', (req, res) => {
  res.json(gcalUrls);
});

app.post('/api/gcal-urls', (req, res) => {
  const { url, label } = req.body;
  if (!url) return res.json({ success: false, message: 'URL이 필요합니다' });
  gcalUrls.push({ url, label: label || 'Google' });
  saveGcalUrls(gcalUrls);
  fetchGcalEvents();
  res.json({ success: true });
});

app.delete('/api/gcal-urls/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (idx >= 0 && idx < gcalUrls.length) {
    gcalUrls.splice(idx, 1);
    saveGcalUrls(gcalUrls);
    fetchGcalEvents();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// iCal feed for Google Calendar subscription
app.get('/api/calendar.ics', (req, res) => {
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//OnjaCalendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:온자 캘린더\r\n';

  for (const [dateKey, entries] of Object.entries(scheduleData)) {
    const d = dateKey.replace(/-/g, '');
    entries.forEach(entry => {
      const uid = entry.id || Date.now() + Math.random();
      ics += 'BEGIN:VEVENT\r\n';
      ics += `DTSTART;VALUE=DATE:${d}\r\n`;
      ics += `DTEND;VALUE=DATE:${d}\r\n`;
      ics += `SUMMARY:[${entry.author}] ${entry.text}\r\n`;
      ics += `UID:${uid}@onja-calendar\r\n`;
      ics += 'END:VEVENT\r\n';
    });
  }

  ics += 'END:VCALENDAR\r\n';
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="onja-calendar.ics"');
  res.send(ics);
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('User connected');

  socket.emit('init', scheduleData);

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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
