# Roadmap

Plans and open questions, roughly in order. Last updated 2026-10-01.

## Where Rikiki can be played today

Searching "rikiki online" turns up rikiki.live (looks dead, no tutorial), a Play Store app that only
keeps score, and Board Game Arena (multiplayer, among 1000+ other games). Nobody offers a polished
single-player Rikiki with bots, offline, on the phone. That gap is the opportunity.

## 1. Bot strength

The bots are stronger than they should be for new players: a player who knows the game well wins about 1 in 10
against Normal bots (with 4 players an even match would be about 1 in 4). Hard is still untried.

Measured 2026-10-01 with a `novice` bot standing in for a beginner (`js/ai.js`: leads a side ace unless
someone is known to be out of the suit, otherwise the lowest side card; plays the lowest legal card; once the guess
is made, throws away big cards when not following suit). Novice win rate at a 4-player table, where an even match is 25%:

| Opponents (3 of them)          | Classic | 20 per trick |
|--------------------------------|---------|--------------|
| Easy with heavy noise (bid 0.8, play 0.5) | ~50% | ~37% |
| Easy (today)                    | ~26–32% | ~18–22% |
| Monte Carlo with 2 samples      | ~18%    | ~11%         |
| Normal                          | 4%      | 1%           |
| Hard                            | 3%      | 3%           |

- There is a cliff between Easy and Normal. Monte Carlo is already at full strength with ~5 samples.
- Novice rounds that score negative: 52% in classic, 10% in 20 per trick.
- Random card plays look silly (an ace thrown away while still needing tricks), so no level plays randomly any more.
  Honest play stays roughly even with a beginner. Getting lower needs visible blunders, so that floor is accepted. The happy
  moments come from elsewhere (short matches, exact guesses, achievements).
- **Done:** "Level 1–5", Level 1 the default. 1 = hand-coded beginner (holds aces back, counts side kings as
  winners; ~24–28% for the novice), 2 = heuristic with ±1 guess noise (~20–29%), 3 = clean heuristic (~12–15%),
  4 = Normal, 5 = Hard. Still a steep step from 3 to 4.
- Classic scoring stays the default: most people know the original rules. 20 per trick has far fewer negative
  rounds (10% vs 52% for the novice), and a cautious beginner underbids there.

## 2. Quick matches

Long matches clash with "play for a few minutes". Resume already helps. Short matches are also where the early
greens come from: against Normal bots the first ~5 rounds give ~3 exact guesses, the long middle rounds far fewer.
Short matches also give the weaker player more wins in classic (33–38% vs 28–31% at max 8 cards).

- A "Quick match" preset on the setup screen, e.g. max 5 cards (9 rounds as a pyramid). The `maxCards`
  option already exists, so this only needs the preset.
- Show how many rounds are left.

## 2b. More original house rules

- **Blind first round:** in the 1-card round you see everyone's card except your own (held to the forehead).
  It's fun, and it often costs someone points. Optional rule.

## 3. First-match guidance

People who don't know the rules quit in the first minute. Short hints during the first round:
what a guess is, why you have to follow suit and beat the winning card, why you have to trump, how scoring works.
They can be dismissed and turned back on in the menu.

## 4. Achievements

All client-side. No platform offers an achievements backend (CrazyGames doesn't).

- **Structure:** a general set, plus one set per rule that changes the feel (classic scoring, 20 per trick,
  jokers, same card beats, no trump / sometimes, first to 500/1000). A match counts toward every set whose rule is on,
  so no specific combinations are needed.
- **Bot level as tiers** (bronze / silver / gold = Easy / Normal / Hard), not as separate sets.
- **Mostly about your own play** (exact guesses, runs), not winning, because winning is rare.
- **Implementation:** pure functions over finished rounds and matches in `game.js` (history + trick logs),
  tested with `node --test`. A separate saved profile for achievements and career counters, because `history` only covers
  the current match. Keep the storage behind one small layer so it can switch to a platform's cloud save later.

Ideas:

- **General:** win a match; win against 7 Hard bots; exact guesses in every round of a match; make a guess of 0
  in the max-card round; take every trick in a big round and have guessed it; come back from last at halfway and win;
  win by 2 (the closest possible win, since all scores are even); finish last with the most rounds on top.
- **Classic:** a run of N exact guesses; a full match with no miss.
- **20 per trick:** 100+ in one round; make a high guess; win without ever guessing 0.
- **Jokers:** hold every joker in play; with same card beats on, beat a joker with a joker; make your guess with a joker as your only trump.
- **Same card beats:** take a trick by copying the winning card; twice in one trick (3+ decks).
- **No trump:** make your guess in the max round with no trump; win a "never" match.
- **First to 500 / 1000:** win the race; win in the fewest rounds; win having trailed until the last round.

## 5. Distribution

Not decided. These don't exclude each other. The same web build can go everywhere.

- **Own website** (e.g. GitHub Pages): free, under our control. A page with the rules and a Play button could
  rank for "rikiki online" and the Hungarian equivalents, since there is little competition.
- **Installable web app (PWA):** add a manifest and a service worker. Then it installs to the home screen, works offline and
  needs no store. This is the cheapest version of "a mobile app".
- **Play Store:** wrap the web build (e.g. Capacitor or a Trusted Web Activity). Google charges a one-time developer
  fee. Searching "rikiki" there finds only a score-keeping app. iOS costs a yearly fee, so later if ever.
- **CrazyGames:** possible, but their audience mostly won't know the game. How it works: a quality check, then a
  2-week **Basic Launch** to a limited audience (SDK optional, no ads). They judge conversion (80%+ still playing after 1 minute),
  average session length (10+ min) and day-1 retention (10–15%). Strong results lead to Full Launch (SDK, ads,
  revenue share). Mixed results allow another try. It's a free experiment and not about the money.
  Their SDK offers cloud save (`data`), leaderboards (MVP, for selected games only, weekly, scores encrypted),
  and invite links. It has no achievements.
- **Hungarian translation:** probably the biggest single win for reaching people who already know the game.

## 6. Multiplayer (only once there is real traction)

Needs a server, hosting and enough players to fill tables. Things in our favour:

- `game.js` is a plain-JSON state machine with no DOM, and it already runs in Node. It can run on a server that has the final say,
  and each player only gets sent their own hand.
- Bots fill empty seats and take over for players who drop out.
- Everyone already guesses at the same moment.
- Low bandwidth: a small websocket room server is enough (Cloudflare Durable Objects, PartyKit, Colyseus).
- An alternative that needs no live server: private tables with friends played turn by turn, without waiting for each other.
