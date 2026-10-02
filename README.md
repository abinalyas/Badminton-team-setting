# Badminton Court Queue

A phone-friendly web app for running a drop-in doubles session fairly.

Play starts at 7am, people arrive any time between 7 and 8, and the first game
starts as soon as 4 people are there. The app keeps one first-come, first-served
line, so you don't have to work out by hand who plays next.

## Rules

1. **Check in on arrival.** Each player joins the back of the line. Earlier
   arrivals play earlier.
2. **Opening games.** When 4 people are present, the first 4 in line go on
   court and play **two games against each other**. Nobody else comes on yet.
3. **Game 3: the only place winning matters.** The winners of game 2 stay on
   and play the next 2 in line. The losers of game 2 go to the back of the line.
4. **After game 3, only the game 2 winners come off.** The 2 people who came on
   for game 3 have only played one game, so they stay for a second game against
   the next 2 in line.
5. **Everyone plays two games in a row, win or lose.** After its second game a
   team comes off and the next 2 in line take the other side, and so on.
6. **Fairness.** People coming off rejoin the line, and whoever has played fewer
   games goes first. Late arrivals join the back of the line.

Winning only decides who gets the extra third game, so the first four have no
lasting advantage beyond getting on court first.

### Usual pairs

Some people want to play with their usual partner. Add them under **Usual
pairs**. Pairs are saved with the session, so you set them up once.

- When both partners are in the next game, they're put on the same team.
- Nobody skips the line for a pair. If only one partner is among the next
  players up, that person plays with someone else for that one game (the app
  shows a note saying so), so the first-come advantage is unchanged.
- Turn it off with **Keep usual pairs together** in the Rules card.

The **Rules** card has switches for the opening games and usual pairs, and the
number of games in a row (2, 3 or 4).

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
