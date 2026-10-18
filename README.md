# fllint-and-arrow
My personal portfolio website built to showcase my web development journey, background, and featured applications

## What is in this repo
- `index.html` - the Flint & Arrow portfolio (home page, with the booking and message form)
- `server.js` - Express server: serves the pages and saves form submissions to `messages.json`
- `package.json` - dependencies (Express)

## Run on your computer
1. Install Node.js
2. `npm install`
3. `npm start` and open http://localhost:3000

## Reading the messages
Set an `ADMIN_KEY` environment variable (a long secret word), then open:
`/admin/messages?key=YOUR_KEY`

## Deploy on Render
- Build command: `npm install`, start command: `npm start`
- Environment: `ADMIN_KEY` (and keep the instance type on Free)
- Note: the free Render disk is wiped on every restart or redeploy, so `messages.json` is lost.
  Open the admin page often and copy messages you need, or move storage to a database.

## Important
Keep `messages.json` out of Git (it is in `.gitignore`). It holds visitors' names and emails.
