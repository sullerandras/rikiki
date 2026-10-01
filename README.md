# Rikiki (Riki tiki)

The trick-guessing card game, played in the browser against computer opponents.
It has no dependencies and needs no build step to play: open `index.html`.

## Play

- **Desktop:** open `index.html` in a browser.
- **Phone, single file:** run `npm run build` and send `dist/rikiki.html` to the phone. It is one self-contained file.
- **Phone, same Wi-Fi:** run `npm run serve` and open the printed `http://<ip>:8080` address.

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

| Level  | How it plays |
|--------|--------------|
| Easy   | Card-counting heuristic with deliberate mistakes. |
| Normal | Monte Carlo: deals the unseen cards randomly, plays every option out to the end of the round and keeps the best. |
| Hard   | More simulations, and it infers hands from the strict rules. For example, a player who followed suit without beating the winning card holds nothing higher in that suit. |

The hint button asks the Hard bot.

## Project layout

```
index.html        page shell
css/style.css     all styling
js/cards.js       deck, shuffling, sorting
js/rules.js       trick winner, legal cards, scoring, round schedule
js/game.js        match state machine (plain JSON, saved to localStorage)
js/ai.js          heuristic + Monte Carlo bots
js/ui.js          rendering, animation, game loop
test/             node --test suites (rules, engine, inference)
tools/build.mjs   bundles everything into dist/rikiki.html
tools/serve.mjs   tiny static server for LAN play
tools/simulate.cjs bot tournament, e.g. `npm run simulate -- 40 normal,hard,normal,hard 8 twenty jokers=2,same,trump=sometimes`
```

The scripts are plain (non-module) files so the page works from `file://`. They attach to `globalThis.Riki`, which lets the Node tests `require()` them directly.
