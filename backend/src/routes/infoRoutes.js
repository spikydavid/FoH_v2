const express = require('express');
const { getInfo } = require('../controllers/infoController');

const router = express.Router();

router.get('/info', getInfo);

module.exports = router;
