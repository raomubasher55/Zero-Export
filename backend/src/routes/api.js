const express = require('express');
const router = express.Router();

// Example API endpoint
router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from Zero Export API!' });
});

// Add more routes here
// router.get('/items', getItems);
// router.post('/items', createItem);

module.exports = router;
