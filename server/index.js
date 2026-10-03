const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'havilah_broks_secret_key_2025';
const PORT = process.env.PORT || 5000;

// 4 Distinct Profiles (2 CEOs, 2 Managers)
const users = [
  { id: 'ceo-1', name: 'CEO 1', email: 'ceo1@farm.local', role: 'CEO', pin: '3333' },
  { id: 'ceo-2', name: 'CEO 2', email: 'ceo2@farm.local', role: 'CEO', pin: '4444' },
  { id: 'mgr-1', name: 'Manager 1', email: 'manager1@farm.local', role: 'Manager', pin: '1111' },
  { id: 'mgr-2', name: 'Manager 2', email: 'manager2@farm.local', role: 'Manager', pin: '2222' },
];

// Persistent shared state in memory across all connected client apps
let batches = [
  { id: 'b-catfish-1', type: 'Catfish', startQuantity: 10000, currentQuantity: 8500, startDate: '2024-10-01', status: 'Active', locationTag: 'Ponds 1-4' },
  { id: 'b-layers-1', type: 'Layers', startQuantity: 5500, currentQuantity: 5200, startDate: '2024-08-15', status: 'Active', locationTag: 'Layer Coop 1' },
  { id: 'b-broilers-1', type: 'Broilers', startQuantity: 3500, currentQuantity: 3400, startDate: '2024-11-01', status: 'Active', locationTag: 'Broiler House A' },
  { id: 'b-cockerels-1', type: 'Cockerels', startQuantity: 2000, currentQuantity: 1950, startDate: '2024-09-10', status: 'Active', locationTag: 'Slow Growth House B' },
];

let dailyLogs = [
  {
    logId: 'log-sample-1',
    batchId: 'b-catfish-1',
    batchName: 'Ponds 1-4',
    animalType: 'Catfish',
    loggedBy: 'Manager 1',
    date: new Date().toISOString(),
    feedConsumedBags: 12.0,
    mortalityCount: 5,
    waterChanged: true,
    notes: 'Morning feeding complete. Water changed in Pond 2.',
    signature: 'Manager 1',
    isBiologicalThreat: false,
    timestamp: new Date().toISOString(),
  },
];

let notifications = [
  {
    id: 'notif-1',
    title: 'Manager 1 submitted daily log',
    message: 'Ponds 1-4 (Catfish): Mortality 5, Feed 12.0 bags',
    manager: 'Manager 1',
    activity: 'Catfish batch log',
    timestamp: new Date().toISOString(),
    isRead: false,
  },
];

let financeRecords = [
  { id: 'tx-1', type: 'Revenue', category: 'Sales', amount: 8525.00, description: 'Fresh Layer Eggs Sale (155 Crates)', date: new Date().toISOString() },
  { id: 'tx-2', type: 'Revenue', category: 'Sales', amount: 14400.00, description: 'Broiler Chicken Batch Off-take', date: new Date().toISOString() },
  { id: 'tx-3', type: 'Expense', category: 'Feed Purchase', amount: 6800.00, description: 'High-Protein Pellets & Layer Mash', date: new Date().toISOString() },
];

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Authentication token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Strict CEO-Only Middleware for Financial Endpoints
const requireCeoRole = (req, res, next) => {
  if (!req.user || req.user.role !== 'CEO') {
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: You do not have security clearance to access financial records.',
      code: 'CEO_CLEARANCE_REQUIRED'
    });
  }
  next();
};

// --- AUTH ROUTES ---
app.post('/api/auth/login', (req, res) => {
  const { userId, pin, role } = req.body;
  let user = null;

  if (userId) {
    user = users.find(u => u.id === userId && u.pin === pin);
  } else if (role && pin) {
    user = users.find(u => u.role === role && u.pin === pin);
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid user PIN or profile credentials.' });
  }

  const token = jwt.sign({ id: user.id, name: user.name, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
});

// --- GET ALL USERS ---
app.get('/api/users', (req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
});

// --- BATCHES ROUTES ---
app.get('/api/batches', authenticateToken, (req, res) => {
  res.json(batches);
});

app.post('/api/batches', authenticateToken, (req, res) => {
  const newBatch = {
    id: req.body.id || `batch-${Date.now()}`,
    type: req.body.type,
    startQuantity: parseInt(req.body.startQuantity) || 0,
    currentQuantity: parseInt(req.body.currentQuantity) || 0,
    startDate: req.body.startDate || new Date().toISOString(),
    status: req.body.status || 'Active',
    locationTag: req.body.locationTag || 'Default Location',
  };
  batches.unshift(newBatch);
  res.status(201).json(newBatch);
});

app.put('/api/batches/:id', authenticateToken, (req, res) => {
  const index = batches.findIndex(b => b.id === req.params.id);
  if (index !== -1) {
    batches[index] = { ...batches[index], ...req.body };
    return res.json(batches[index]);
  }
  res.status(404).json({ error: 'Batch not found' });
});

app.delete('/api/batches/:id', authenticateToken, (req, res) => {
  batches = batches.filter(b => b.id !== req.params.id);
  dailyLogs = dailyLogs.filter(l => l.batchId !== req.params.id);
  res.json({ success: true });
});

// --- DAILY LOGS ROUTES (Managers update, CEOs view) ---
app.get('/api/daily-logs', authenticateToken, (req, res) => {
  res.json(dailyLogs);
});

app.post('/api/daily-logs', authenticateToken, (req, res) => {
  const {
    batchId,
    batchName,
    animalType,
    loggedBy,
    date,
    feedConsumedBags,
    mortalityCount,
    eggsCollectedTrays,
    damagedEggsCount,
    waterChanged,
    notes,
    signature,
  } = req.body;

  // Find batch and update stock count
  const batch = batches.find(b => b.id === batchId);
  const currentPopulation = batch ? batch.currentQuantity : 1000;

  if (batch && mortalityCount > 0) {
    batch.currentQuantity = Math.max(0, batch.currentQuantity - mortalityCount);
  }

  const mortalityPct = currentPopulation > 0 ? (mortalityCount / currentPopulation) * 100 : 0;
  const isBiologicalThreat = mortalityPct >= 1.5;

  const newLog = {
    logId: req.body.logId || `log-${Date.now()}`,
    batchId,
    batchName: batchName || (batch ? batch.locationTag : 'Unknown Batch'),
    animalType: animalType || (batch ? batch.type : 'Catfish'),
    loggedBy: loggedBy || req.user.name,
    date: date || new Date().toISOString(),
    feedConsumedBags: parseFloat(feedConsumedBags) || 0,
    mortalityCount: parseInt(mortalityCount) || 0,
    eggsCollectedTrays: eggsCollectedTrays ? parseInt(eggsCollectedTrays) : null,
    damagedEggsCount: damagedEggsCount ? parseInt(damagedEggsCount) : null,
    waterChanged: !!waterChanged,
    notes: notes || '',
    signature: signature || req.user.name,
    timestamp: new Date().toISOString(),
    isBiologicalThreat,
  };

  dailyLogs.unshift(newLog);

  // Broadcast Notification for CEOs
  const newNotif = {
    id: `notif-${Date.now()}`,
    title: `${newLog.loggedBy} submitted daily log`,
    message: `${newLog.batchName}: Mortality ${newLog.mortalityCount}, Feed ${newLog.feedConsumedBags} bags`,
    manager: newLog.loggedBy,
    activity: `${newLog.animalType} batch log`,
    timestamp: new Date().toISOString(),
    isRead: false,
  };
  notifications.unshift(newNotif);

  res.status(201).json({ message: 'Daily activity logged and synced online successfully', log: newLog, notification: newNotif });
});

// --- NOTIFICATIONS ROUTES ---
app.get('/api/notifications', authenticateToken, (req, res) => {
  res.json(notifications);
});

app.post('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const notif = notifications.find(n => n.id === req.params.id);
  if (notif) {
    notif.isRead = true;
    return res.json(notif);
  }
  res.status(404).json({ error: 'Notification not found' });
});

// --- FINANCIAL ENDPOINTS (STRICT CEO ONLY) ---
app.get('/api/finances', authenticateToken, requireCeoRole, (req, res) => {
  const revenue = financeRecords.filter(f => f.type === 'Revenue').reduce((acc, f) => acc + f.amount, 0);
  const expenses = financeRecords.filter(f => f.type === 'Expense').reduce((acc, f) => acc + f.amount, 0);

  res.json({
    monthlyRevenue: revenue,
    monthlyExpenses: expenses,
    netProfit: revenue - expenses,
    transactions: financeRecords,
  });
});

app.post('/api/finances', authenticateToken, requireCeoRole, (req, res) => {
  const record = {
    id: `tx-${Date.now()}`,
    recordedBy: req.user.name,
    type: req.body.type,
    category: req.body.category,
    amount: parseFloat(req.body.amount) || 0,
    description: req.body.description,
    date: req.body.date || new Date().toISOString(),
  };
  financeRecords.unshift(record);
  res.status(201).json(record);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Havilah Broks Farm ERP Online Server running on http://0.0.0.0:${PORT}`);
});
