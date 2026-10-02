# Badminton Court Queue

A phone-friendly web app for running a drop-in doubles session fairly.

Play starts at 7am, people arrive any time between 7 and 8, and the first game
starts as soon as 4 people are there. The app keeps one first-come, first-served
line, so you don't have to work out by hand who plays next.

## Rules

1. **Check in on arrival.** Each player joins the back of the line. Earlier
   arrivals play earlier.
2. **First game.** When 4 people are present, the first 4 in line go on court.
3. **Winners stay, losers go to the back.** After each game the losing pair
   goes to the back of the line and the next 2 in line come on to challenge.
4. **Max games in a row (default 2).** A pair that has played 2 games in a row
   comes off even if they win, and the next 4 in line go on.

Rule 4 fixes the old "only the first shift benefits from winning" problem.
The same cap applies to every group, so winning always earns exactly one
more game, whether you started at 7:00 or 7:45, and nobody holds the court.

You can switch off "winners stay" (all 4 come off after every game) or raise
the cap to 3 or 4 in the **Rules** card.

## Features

- Check in by picking a player from the dropdown (the regular group is built in;
  "Someone else…" adds a new name, which is remembered).
- Tap the winning pair to record a result. The next game is set up
  automatically.
- See the line with each player's position, games played, and arrival time.
  The players coming on next are highlighted.
- Mark a waiting player as **Left** if they go home early.
- See games and wins per player for today.
- **Undo** a mis-tap.
- Everything is saved on the phone (localStorage), so a page refresh doesn't
  lose the session.

## Development

```bash
npm install
npm run dev     # local dev server
npm test        # rotation rule tests
npm run build   # production build in dist/
```

The rotation rules are in `src/rotation.ts` (pure functions, tested in
`src/rotation.test.ts`). The UI is in `src/App.tsx`.

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes the app to GitHub
Pages on every push to `main`. Turn it on once under **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The app will then be at
`https://abinalyas.github.io/badminton-team-setting/`. Pages for a private
repository needs a paid GitHub plan.
