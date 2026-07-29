# Zero Export

Full-stack application with React + Node.js.

## Stack

**Frontend:**
- React 18 + Vite 6
- Tailwind CSS v4
- Radix UI (accessible, unstyled primitives)
- Lucide Icons
- CVA (class-variance-authority) for type-safe variants

**Backend:**
- Node.js + Express
- Helmet (security headers)
- CORS
- Morgan (request logging)

## Quick Start

```bash
# Install all dependencies (root + backend + frontend)
npm run install:all

# Start both servers concurrently
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

## Project Structure

```
Zero-Export/
├── package.json          # Root - runs both with concurrently
├── backend/
│   ├── package.json
│   └── src/
│       ├── index.js      # Express server
│       └── routes/
│           └── api.js    # API routes
└── frontend/
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css      # Tailwind + theme
        ├── lib/
        │   └── utils.js   # cn() helper
        └── components/
            └── ui/        # Radix UI components
                ├── button.jsx
                ├── badge.jsx
                ├── card.jsx
                ├── dialog.jsx
                ├── input.jsx
                ├── label.jsx
                ├── separator.jsx
                ├── switch.jsx
                ├── tabs.jsx
                └── tooltip.jsx
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend & backend |
| `npm run dev:frontend` | Start frontend only |
| `npm run dev:backend` | Start backend only |
| `npm run install:all` | Install all dependencies |
| `npm run build` | Build frontend for production |
