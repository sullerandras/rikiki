# Rikiki (Riki tiki)

The trick-guessing card game, played in the browser against computer opponents.
It has no dependencies and needs no build step to play: open `index.html`.

## Play

- **Online:** [play Rikiki on Claude](https://claude.ai/artifact/Jp9W4Sp1p2VxAYQmddQ8WJ). No install, works on phones too.
- **Install as an app:** open [sullerandras.github.io/rikiki](https://sullerandras.github.io/rikiki/) and choose
  "Install app" or "Add to Home Screen". It works offline and updates itself.
- **Desktop:** open `index.html` in a browser.
- **Phone, single file:** run `npm run build` and send `dist/rikiki.html` to the phone. It is one self-contained file.
- **Phone, same Wi-Fi:** run `npm run serve` and open the printed `http://<ip>:8080` address.

## Web app (GitHub Pages)

`npm run build` also writes `dist/site/`: the separate files plus `manifest.webmanifest`, the PNG icons and `sw.js`.
The service worker caches the game and the latin Google Fonts so it starts offline. The build stamps a hash of
the content into `sw.js`, so each deploy that changes anything installs a new worker. That worker takes over at once,
and the page reloads the next time it is on the start screen, never mid-match. An open app also checks for
a new version whenever it comes back to the foreground.
The start screen shows the version under the setup form: the commit date and short hash, for example
`2026-10-02-1863324`. A trailing `+` means it was built from uncommitted changes; `dev` means unbuilt `index.html`.

Only the site build links the manifest, so `index.html`, `dist/rikiki.html` and the Claude artifact run without a
service worker. To try the site locally: `npm run build && node tools/serve.mjs 8080 dist/site`, then open
`http://localhost:8080` (service workers need HTTPS or localhost).

`.github/workflows/pages.yml` tests, builds and deploys on every push to `master`. One-time setup: in the repo's
Settings → Pages, set Source to "GitHub Actions".

The match is saved in the browser after every card, so you can close the tab and continue later.

## Rules as implemented

- 3 to 8 players (you plus 2 to 7 bots), 1 to 4 French decks (2 by default).
- Round sizes run 1 → max → 1 by default (1 → max and max → 1 are also available).
  After the deal, the next card is turned up and its suit is trump. That card is out of play.
- Everyone guesses their tricks at the same moment ("1, 2, 3!"). Bots can't see your guess.
- The player after the dealer leads. The leader may play anything.
- Followers must follow suit and **beat the winning card if they can**. With no card of the led suit
  they must trump, and over-trump if they can. With neither, anything goes.
- With identical cards from two decks, the one played first wins.
- Score (classic): exact guess = 10 + 2 × tricks; a miss = −2 × difference.

### Variants (setup screen)

- **20 per trick scoring:** if you take at least your guess, 20 × guess − 2 × extra tricks. If you fall short,
  −2 × missing tricks. A zero guess is 10 − 2 × tricks taken. Guess 2, take 5 = 34; guess 5, take 2 = −6.
- **First to 500 / 1000:** the round order repeats until someone reaches the target. The match ends after
  that round, and the highest score wins.
- **Jokers (1 to 4 per deck):** suitless and all equal, they are the highest trumps, above the trump ace.
  They follow the trump rules: you can't play one while you can follow suit, you must play one to beat a
  trump you can't otherwise beat, and a led joker asks for trumps. Without a trump suit, the jokers are the only trumps.
- **Same card beats:** a card identical to the winning one takes the trick (a later A♥ beats an earlier A♥).
  It counts as beating, so it must be played when you have to beat.
- **Trump: always / sometimes / never.** Always: a turned-up joker goes back and the next suited card is turned.
  Sometimes: a turned-up joker means no trump that round, or without jokers, 1 round in 5 has none at random.
  Never: nothing is turned up.

## Bots

| Level | How it plays |
|-------|--------------|
| 1     | A beginner's habits: guesses its aces, kings and high trumps; leads small cards and keeps its aces for later; plays the lowest card allowed; once its guess is made, throws away big cards when it can't follow suit. |
| 2     | Card-counting heuristic that sometimes guesses one off. |
| 3     | The same heuristic, no mistakes. |
| 4     | Monte Carlo: deals the unseen cards randomly, plays every option out to the end of the round and keeps the best. |
| 5     | More simulations, and it infers hands from the strict rules. For example, a player who followed suit without beating the winning card holds nothing higher in that suit. |

Level 1 is the default. Bots never play a random card, so their mistakes look like a person's. Matches saved with the
old easy / normal / hard levels load as 2 / 4 / 5. The hint button asks level 5.

## Project layout

```
index.html        page shell
sw.js             service worker for the hosted site (offline + updates)
manifest.webmanifest, icons/   install metadata and PNG icons
css/style.css     all styling
js/cards.js       deck, shuffling, sorting
js/rules.js       trick winner, legal cards, scoring, round schedule
js/game.js        match state machine (plain JSON, saved to localStorage)
js/ai.js          heuristic + Monte Carlo bots
js/ui.js          rendering, animation, game loop
test/             node --test suites (rules, engine, inference)
tools/build.mjs   bundles everything into dist/rikiki.html, and builds dist/site/ for GitHub Pages
tools/serve.mjs   tiny static server for LAN play
tools/simulate.cjs bot tournament, e.g. `npm run simulate -- 40 1,3,4,5 8 twenty jokers=2,same,trump=sometimes`
```

The scripts are plain (non-module) files so the page works from `file://`. They attach to `globalThis.Riki`, which lets the Node tests `require()` them directly.
