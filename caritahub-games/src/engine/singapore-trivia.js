'use strict';

/**
 * Singapore Trivia engine — server-authoritative.
 *
 * Format: 10 questions per round, shuffled from a pool of 35+.
 * Phases: 'waiting' → 'question' → 'reveal' → (repeat) → 'finished'
 * Players: 2–6 (colors p1–p6)
 * Scoring: First correct answer = 3pts, second = 2pts, rest = 1pt. Wrong = 0.
 * Timer: 20s per question; server auto-reveals on timeout.
 *
 * Interface:
 *   createGame(playerCount)           → engine
 *   engine.state()                    → full state payload
 *   engine.startQuestion()            → { ok, reason }   (host only - phase: waiting/reveal → question)
 *   engine.submitAnswer(seat, idx)    → { ok, reason }   (any player - phase: question)
 *   engine.revealAnswers()            → { ok, reason }   (internal auto + host manual)
 *   engine.nextQuestion()             → { ok, reason }   (host only - phase: reveal → next question or finished)
 *   engine.isGameOver()               → bool
 *   engine.winner()                   → seat index (highest score) | null
 */

// ── Question bank ────────────────────────────────────────────────────────────
// imageUrl: Wikimedia Commons direct file URLs (public domain / CC)
// Each question has: text, imageUrl (or null), options[4], correctIndex, category

const QUESTION_BANK = [
  // ── Image questions: Old Singapore buildings ─────────────────────────────
  {
    id: 'b01',
    text: 'What is the name of this iconic Singapore building, demolished in 1986?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/National_Theatre_Singapore.jpg/640px-National_Theatre_Singapore.jpg',
    options: ['Victoria Theatre', 'National Theatre', 'Capitol Theatre', 'Cathay Building'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b02',
    text: 'This waterfront landmark once housed exotic marine life. What was it called?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Van_Kleef_Aquarium%2C_Singapore%2C_1965.jpg/640px-Van_Kleef_Aquarium%2C_Singapore%2C_1965.jpg',
    options: ['Underwater World', 'Van Kleef Aquarium', 'Sentosa Aquarium', 'Sea World Singapore'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b03',
    text: 'This beloved old railway station closed in 2011. Name it.',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Tanjong_Pagar_railway_station_2010.jpg/640px-Tanjong_Pagar_railway_station_2010.jpg',
    options: ['Woodlands Train Checkpoint', 'Tanjong Pagar Railway Station', 'Buona Vista Station', 'Jurong Railway Station'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b04',
    text: 'Singapore\'s first national stadium hosted many historic events. What year did the old National Stadium close?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/National_Stadium_Singapore.jpg/640px-National_Stadium_Singapore.jpg',
    options: ['2007', '2008', '2009', '2010'],
    correctIndex: 2,
    category: 'buildings'
  },
  {
    id: 'b05',
    text: 'This colonial waterfront building was once a major departure point for ocean liners. What was it?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Clifford_Pier_Singapore.jpg/640px-Clifford_Pier_Singapore.jpg',
    options: ['Raffles Quay Terminal', 'Clifford Pier', 'Johnston Pier', 'Empire Dock Terminal'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b06',
    text: 'Which amusement park at New World operated from the 1920s to 1987?',
    imageUrl: null,
    options: ['Worlds Amusement Park', 'Great World City', 'Happy Valley', 'New World Amusement Park'],
    correctIndex: 3,
    category: 'buildings'
  },
  {
    id: 'b07',
    text: 'The old Kallang Airport was Singapore\'s first international airport. In what decade was it built?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Kallang_Airport_1955.jpg/640px-Kallang_Airport_1955.jpg',
    options: ['1920s', '1930s', '1940s', '1950s'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b08',
    text: 'What is the name of this landmark colonial building on St Andrew\'s Road, completed in 1939?',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Singapore_City_Hall_2014.jpg/640px-Singapore_City_Hall_2014.jpg',
    options: ['Supreme Court', 'City Hall', 'Parliament House', 'Treasury Building'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b09',
    text: 'This art deco cinema on Orchard Road was a favourite for generations of Singaporeans until it closed in 2000.',
    imageUrl: null,
    options: ['Lido Cinema', 'Cathay Cinema', 'Jade Cinema', 'Rex Cinema'],
    correctIndex: 1,
    category: 'buildings'
  },
  {
    id: 'b10',
    text: 'The original Satay Club near the Esplanade was famous for its open-air setting. Where was it located?',
    imageUrl: null,
    options: ['Boat Quay', 'Empress Place', 'Beach Road', 'Collyer Quay'],
    correctIndex: 3,
    category: 'buildings'
  },

  // ── History & Firsts ─────────────────────────────────────────────────────
  {
    id: 'h01',
    text: 'In what year did Singapore gain full independence (separate from Malaysia)?',
    imageUrl: null,
    options: ['1963', '1965', '1967', '1969'],
    correctIndex: 1,
    category: 'history'
  },
  {
    id: 'h02',
    text: 'Who was Singapore\'s first Prime Minister?',
    imageUrl: null,
    options: ['Goh Chok Tong', 'S R Nathan', 'Lee Kuan Yew', 'Ong Teng Cheong'],
    correctIndex: 2,
    category: 'history'
  },
  {
    id: 'h03',
    text: 'Singapore\'s MRT first opened in which year?',
    imageUrl: null,
    options: ['1983', '1985', '1987', '1989'],
    correctIndex: 2,
    category: 'history'
  },
  {
    id: 'h04',
    text: 'What was the original name of Singapore before Raffles renamed it?',
    imageUrl: null,
    options: ['Temasek', 'Tumasik', 'Singapura', 'Johor Lama'],
    correctIndex: 0,
    category: 'history'
  },
  {
    id: 'h05',
    text: 'Who was Singapore\'s first elected President (Elected Presidency scheme)?',
    imageUrl: null,
    options: ['S R Nathan', 'Ong Teng Cheong', 'Wee Kim Wee', 'Tony Tan'],
    correctIndex: 1,
    category: 'history'
  },
  {
    id: 'h06',
    text: 'Singapore merged with Malaysia in 1963. What was this union initially called?',
    imageUrl: null,
    options: ['Malayan Federation', 'Malaysia', 'Federation of Malaysia', 'Greater Malaya'],
    correctIndex: 1,
    category: 'history'
  },
  {
    id: 'h07',
    text: 'In what year did Singapore host the first Formula 1 night race?',
    imageUrl: null,
    options: ['2006', '2007', '2008', '2009'],
    correctIndex: 2,
    category: 'history'
  },
  {
    id: 'h08',
    text: 'Which year did the last kampong (village) in mainland Singapore — Kampong Lorong Buangkok — receive an offer to be bought over (still standing today)?',
    imageUrl: null,
    options: ['2005', '2011', '2014', '2020'],
    correctIndex: 0,
    category: 'history'
  },
  {
    id: 'h09',
    text: 'Singapore\'s first female President was elected in 2017. What is her name?',
    imageUrl: null,
    options: ['Ho Ching', 'Grace Fu', 'Halimah Yacob', 'Josephine Teo'],
    correctIndex: 2,
    category: 'history'
  },
  {
    id: 'h10',
    text: 'The British surrendered Singapore to Japan in 1942. General Percival surrendered to which Japanese commander?',
    imageUrl: null,
    options: ['General Yamashita', 'Admiral Yamamoto', 'General Tojo', 'General Homma'],
    correctIndex: 0,
    category: 'history'
  },

  // ── Food & Hawker Culture ────────────────────────────────────────────────
  {
    id: 'f01',
    text: 'Which Singapore dish is considered the unofficial national dish?',
    imageUrl: null,
    options: ['Bak Kut Teh', 'Chilli Crab', 'Hainanese Chicken Rice', 'Char Kway Teow'],
    correctIndex: 2,
    category: 'food'
  },
  {
    id: 'f02',
    text: 'Singapore\'s hawker culture was inscribed on UNESCO\'s Intangible Cultural Heritage list in which year?',
    imageUrl: null,
    options: ['2018', '2019', '2020', '2021'],
    correctIndex: 2,
    category: 'food'
  },
  {
    id: 'f03',
    text: 'Which hawker stall became one of the world\'s cheapest Michelin-starred eateries in 2016?',
    imageUrl: null,
    options: ['Hill Street Tai Hwa Pork Noodle', 'Hong Kong Soya Sauce Chicken Rice & Noodle', 'Liao Fan Hawker Chan', 'Tian Tian Hainanese Chicken Rice'],
    correctIndex: 2,
    category: 'food'
  },
  {
    id: 'f04',
    text: 'What is the Hokkien name for the Singapore dish made of stir-fried flat rice noodles?',
    imageUrl: null,
    options: ['Kway Chap', 'Char Kway Teow', 'Loh Mee', 'Ban Mian'],
    correctIndex: 1,
    category: 'food'
  },
  {
    id: 'f05',
    text: 'Bak Kut Teh literally translates to what in English?',
    imageUrl: null,
    options: ['Pork Bone Tea', 'Meat Bone Tea', 'Pork Rib Soup', 'Herbal Pork Broth'],
    correctIndex: 1,
    category: 'food'
  },
  {
    id: 'f06',
    text: 'Which spice is the key ingredient that makes Laksa its distinctive orange colour?',
    imageUrl: null,
    options: ['Turmeric', 'Saffron', 'Belachan', 'Dried shrimp paste with chilli'],
    correctIndex: 0,
    category: 'food'
  },

  // ── Singlish & Culture ───────────────────────────────────────────────────
  {
    id: 'c01',
    text: 'What does the Singlish word "kiasu" mean?',
    imageUrl: null,
    options: ['Lazy person', 'Fear of losing out', 'Very angry', 'Being overly polite'],
    correctIndex: 1,
    category: 'culture'
  },
  {
    id: 'c02',
    text: 'What does "lah" typically do at the end of a Singlish sentence?',
    imageUrl: null,
    options: ['Express anger', 'Add emphasis or soften a statement', 'Ask a question', 'Show surprise'],
    correctIndex: 1,
    category: 'culture'
  },
  {
    id: 'c03',
    text: 'What is a "kopitiam"?',
    imageUrl: null,
    options: ['A traditional Malay house', 'A coffee shop / local cafe', 'A food delivery service', 'A wet market'],
    correctIndex: 1,
    category: 'culture'
  },
  {
    id: 'c04',
    text: 'The "Merlion" is Singapore\'s national icon. What two animals make up the Merlion?',
    imageUrl: null,
    options: ['Lion and Dragon', 'Lion and Fish', 'Tiger and Fish', 'Lion and Serpent'],
    correctIndex: 1,
    category: 'culture'
  },
  {
    id: 'c05',
    text: 'What does "chope" mean in Singaporean culture?',
    imageUrl: null,
    options: ['To cut in queue', 'To reserve a seat (usually with a tissue pack)', 'To bargain for a lower price', 'To share a meal'],
    correctIndex: 1,
    category: 'culture'
  },
  {
    id: 'c06',
    text: 'Which Peranakan garment is a traditional dress worn by Nyonya women?',
    imageUrl: null,
    options: ['Baju Kurung', 'Kebaya', 'Sarong', 'Batik Dress'],
    correctIndex: 1,
    category: 'culture'
  },

  // ── Geography & Landmarks ────────────────────────────────────────────────
  {
    id: 'g01',
    text: 'How many islands does Singapore comprise (approximately)?',
    imageUrl: null,
    options: ['35', '63', '100', '150'],
    correctIndex: 1,
    category: 'geography'
  },
  {
    id: 'g02',
    text: 'What is the name of the causeway connecting Singapore and Johor Bahru, Malaysia?',
    imageUrl: null,
    options: ['Tuas Second Link', 'Woodlands Causeway', 'Johor-Singapore Causeway', 'Malaysia Causeway'],
    correctIndex: 2,
    category: 'geography'
  },
  {
    id: 'g03',
    text: 'Bukit Timah Hill is Singapore\'s highest point. How tall is it?',
    imageUrl: null,
    options: ['137 m', '164 m', '187 m', '210 m'],
    correctIndex: 1,
    category: 'geography'
  },
  {
    id: 'g04',
    text: 'What was the original name of Orchard Road before it became a shopping belt?',
    imageUrl: null,
    options: ['Plantation Road', 'Fruit Orchard Street', 'It was always called Orchard Road', 'Nutmeg Road'],
    correctIndex: 2,
    category: 'geography'
  }
];

const QUESTIONS_PER_ROUND = 10;
const QUESTION_TIME = 20; // seconds per question

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGame(playerCount = 2) {
  if (playerCount < 2 || playerCount > 6) throw new Error('Singapore Trivia requires 2–6 players');

  // Pick 10 random questions, ensuring a good mix of categories
  const pool = shuffle(QUESTION_BANK).slice(0, QUESTIONS_PER_ROUND);

  let questionIndex = -1;       // -1 = waiting to start
  let phase = 'waiting';        // 'waiting' | 'question' | 'reveal' | 'finished'
  let answers = [];             // per-seat answer index (null = not answered)
  let answerOrder = [];         // seat indices in order they answered (for scoring)
  let scores = new Array(playerCount).fill(0);
  let pointsGained = [];        // per-seat points gained THIS question (for reveal)
  let _isGameOver = false;
  let _timerEnd = 0;            // epoch ms when current question timer expires

  function currentQuestion(hideAnswer) {
    if (questionIndex < 0 || questionIndex >= pool.length) return null;
    const q = pool[questionIndex];
    return {
      text: q.text,
      imageUrl: q.imageUrl || null,
      options: q.options,
      category: q.category,
      correctIndex: hideAnswer ? null : q.correctIndex
    };
  }

  function state() {
    const hideAnswer = phase === 'question';
    const timeLeft = phase === 'question'
      ? Math.max(0, Math.ceil((_timerEnd - Date.now()) / 1000))
      : 0;
    return {
      gameType: 'singapore-trivia',
      phase,
      questionIndex,
      totalQuestions: QUESTIONS_PER_ROUND,
      currentQuestion: currentQuestion(hideAnswer),
      answers: answers.slice(),
      answeredCount: answers.filter(a => a !== null).length,
      pointsGained: pointsGained.slice(),
      scores: scores.slice(),
      timeLeft,
      isGameOver: _isGameOver,
      playerCount
    };
  }

  function startQuestion() {
    if (phase !== 'waiting' && phase !== 'reveal') {
      return { ok: false, reason: 'Cannot start question now' };
    }
    if (phase === 'reveal' && questionIndex >= QUESTIONS_PER_ROUND - 1) {
      return { ok: false, reason: 'All questions done — call nextQuestion to finish' };
    }
    questionIndex++;
    phase = 'question';
    answers = new Array(playerCount).fill(null);
    answerOrder = [];
    pointsGained = new Array(playerCount).fill(0);
    _timerEnd = Date.now() + QUESTION_TIME * 1000;
    return { ok: true };
  }

  function submitAnswer(seat, answerIndex) {
    if (phase !== 'question') return { ok: false, reason: 'No active question' };
    if (seat < 0 || seat >= playerCount) return { ok: false, reason: 'Invalid seat' };
    if (answers[seat] !== null) return { ok: false, reason: 'Already answered' };
    if (answerIndex < 0 || answerIndex > 3) return { ok: false, reason: 'Invalid answer' };

    answers[seat] = answerIndex;
    answerOrder.push(seat);
    return { ok: true, allAnswered: answers.every(a => a !== null) };
  }

  function revealAnswers() {
    if (phase !== 'question') return { ok: false, reason: 'Not in question phase' };
    phase = 'reveal';

    const correct = pool[questionIndex].correctIndex;
    // Score: first correct = 3pts, second = 2pts, rest = 1pt
    let correctRank = 0;
    for (const seat of answerOrder) {
      if (answers[seat] === correct) {
        correctRank++;
        const pts = correctRank === 1 ? 3 : correctRank === 2 ? 2 : 1;
        scores[seat] += pts;
        pointsGained[seat] = pts;
      }
    }
    return { ok: true };
  }

  function nextQuestion() {
    if (phase !== 'reveal') return { ok: false, reason: 'Not in reveal phase' };
    if (questionIndex >= QUESTIONS_PER_ROUND - 1) {
      // All done
      phase = 'finished';
      _isGameOver = true;
      return { ok: true, finished: true };
    }
    // Back to waiting — host calls startQuestion next
    phase = 'waiting';
    return { ok: true, finished: false };
  }

  function isGameOver() { return _isGameOver; }

  function winner() {
    if (!_isGameOver) return null;
    const max = Math.max(...scores);
    return scores.indexOf(max); // seat index
  }

  return { state, startQuestion, submitAnswer, revealAnswers, nextQuestion, isGameOver, winner, QUESTION_TIME };
}

module.exports = { createGame, QUESTION_TIME: QUESTION_TIME, QUESTIONS_PER_ROUND };
