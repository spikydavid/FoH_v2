import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="container">
    <h1>FoH_v2 Full Stack Starter</h1>
    <p class="subtitle">Vite frontend with an Express backend.</p>
    <button id="ping-api" type="button">Call Backend API</button>
    <pre id="result">Click the button to call /api/hello</pre>
  </main>
`;

const button = document.querySelector('#ping-api');
const result = document.querySelector('#result');

button.addEventListener('click', async () => {
  result.textContent = 'Loading...';

  try {
    const response = await fetch('/api/hello');
    const data = await response.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    result.textContent = `Request failed: ${error.message}`;
  }
});
