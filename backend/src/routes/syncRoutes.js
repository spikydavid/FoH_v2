const express = require('express');
const { syncContracts, syncSpecialists } = require('../controllers/syncController');

const router = express.Router();

router.post('/sync/contracts', syncContracts);
router.post('/sync/specialists', syncSpecialists);

module.exports = router;
