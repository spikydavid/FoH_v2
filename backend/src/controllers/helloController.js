function getHello(_req, res) {
  res.json({ message: 'Hello from the Express backend.' });
}

module.exports = {
  getHello,
};
