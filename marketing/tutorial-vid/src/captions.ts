/**
 * What the captions say and when: the narration word by word, how the words
 * group into caption lines, and the step label shown above them.
 */

export interface Word {
  readonly w: string
  readonly s: number
  readonly e: number
}

/** Every word of the narration, with when it starts and ends (seconds). From a speech-to-text pass over assets/script-audio.wav. */
export const WORDS: ReadonlyArray<Word> = [
  { w: "tired", s: 0.0, e: 0.3 }, { w: "of", s: 0.3, e: 0.54 }, { w: "not", s: 0.54, e: 0.82 },
  { w: "getting", s: 0.82, e: 1.08 }, { w: "the", s: 1.08, e: 1.3 }, { w: "class", s: 1.3, e: 1.54 },
  { w: "you", s: 1.54, e: 1.74 }, { w: "want?", s: 1.74, e: 2.04 }, { w: "Install", s: 2.86, e: 2.86 },
  { w: "the", s: 2.96, e: 3.04 }, { w: "extension", s: 3.04, e: 3.5 }, { w: "and", s: 3.5, e: 4.0 },
  { w: "you", s: 4.0, e: 4.1 }, { w: "only", s: 4.1, e: 4.34 }, { w: "have", s: 4.34, e: 4.56 },
  { w: "three", s: 4.56, e: 4.98 }, { w: "easy", s: 4.98, e: 5.38 }, { w: "steps", s: 5.38, e: 5.72 },
  { w: "left.", s: 5.72, e: 6.2 }, { w: "First,", s: 6.82, e: 7.02 }, { w: "head", s: 7.46, e: 7.58 },
  { w: "to", s: 7.58, e: 7.74 }, { w: "the", s: 7.74, e: 7.86 }, { w: "classes", s: 7.86, e: 8.3 },
  { w: "website.", s: 8.3, e: 8.68 }, { w: "Search", s: 9.34, e: 9.36 }, { w: "for", s: 9.5, e: 9.58 },
  { w: "the", s: 9.58, e: 9.72 }, { w: "class", s: 9.72, e: 9.98 }, { w: "and", s: 9.98, e: 10.16 },
  { w: "term", s: 10.16, e: 10.38 }, { w: "you", s: 10.38, e: 10.56 }, { w: "need", s: 10.56, e: 10.86 },
  { w: "and", s: 10.86, e: 11.22 }, { w: "open", s: 11.22, e: 11.54 }, { w: "the", s: 11.54, e: 11.7 },
  { w: "course", s: 11.7, e: 11.92 }, { w: "details.", s: 11.92, e: 12.46 }, { w: "Second,", s: 13.46, e: 13.46 },
  { w: "scroll", s: 13.94, e: 14.18 }, { w: "down", s: 14.18, e: 14.44 }, { w: "to", s: 14.44, e: 14.7 },
  { w: "All", s: 14.7, e: 14.96 }, { w: "Sections", s: 14.96, e: 15.44 }, { w: "and", s: 15.44, e: 15.84 },
  { w: "pick", s: 15.84, e: 16.02 }, { w: "your", s: 16.02, e: 16.22 }, { w: "exact", s: 16.22, e: 16.68 },
  { w: "section.", s: 16.68, e: 17.2 }, { w: "Third,", s: 17.86, e: 18.04 }, { w: "confirm", s: 18.5, e: 18.82 },
  { w: "the", s: 18.82, e: 19.04 }, { w: "section", s: 19.04, e: 19.34 }, { w: "at", s: 19.34, e: 19.5 },
  { w: "the", s: 19.5, e: 19.64 }, { w: "top", s: 19.64, e: 19.9 }, { w: "and", s: 19.9, e: 20.18 },
  { w: "click", s: 20.18, e: 20.48 }, { w: "Notify", s: 20.48, e: 21.0 }, { w: "me.", s: 21.0, e: 21.54 },
  { w: "Enter", s: 21.9, e: 22.16 }, { w: "your", s: 22.16, e: 22.36 }, { w: "email", s: 22.36, e: 22.7 },
  { w: "and", s: 22.7, e: 23.02 }, { w: "type", s: 23.02, e: 23.26 }, { w: "in", s: 23.26, e: 23.46 },
  { w: "your", s: 23.46, e: 23.6 }, { w: "verification", s: 23.6, e: 24.02 }, { w: "code.", s: 24.02, e: 24.64 },
  { w: "Once", s: 24.64, e: 25.22 }, { w: "the", s: 25.22, e: 25.44 }, { w: "button", s: 25.44, e: 25.66 },
  { w: "switches", s: 25.66, e: 25.94 }, { w: "to", s: 25.94, e: 26.28 }, { w: "Watching,", s: 26.28, e: 26.64 },
  { w: "your", s: 27.14, e: 27.22 }, { w: "alert", s: 27.22, e: 27.54 }, { w: "is", s: 27.54, e: 27.84 },
  { w: "live.", s: 27.84, e: 28.24 }, { w: "You", s: 28.88, e: 28.94 }, { w: "can", s: 28.94, e: 29.08 },
  { w: "manage", s: 29.08, e: 29.36 }, { w: "your", s: 29.36, e: 29.56 }, { w: "tracked", s: 29.56, e: 29.84 },
  { w: "classes", s: 29.84, e: 30.28 }, { w: "anytime", s: 30.28, e: 30.66 }, { w: "in", s: 30.66, e: 31.16 },
  { w: "the", s: 31.16, e: 31.26 }, { w: "extension", s: 31.26, e: 31.64 }, { w: "pop-up,", s: 31.64, e: 32.22 },
  { w: "and", s: 32.22, e: 32.8 }, { w: "you", s: 32.8, e: 33.04 }, { w: "will", s: 33.04, e: 33.16 },
  { w: "get", s: 33.16, e: 33.3 }, { w: "an", s: 33.3, e: 33.46 }, { w: "email", s: 33.46, e: 33.8 },
  { w: "the", s: 33.8, e: 34.04 }, { w: "moment", s: 34.04, e: 34.44 }, { w: "a", s: 34.44, e: 34.66 },
  { w: "seat", s: 34.66, e: 34.82 }, { w: "opens.", s: 34.82, e: 35.16 }, { w: "What", s: 35.82, e: 35.9 },
  { w: "are", s: 35.9, e: 36.0 }, { w: "you", s: 36.0, e: 36.1 }, { w: "waiting", s: 36.1, e: 36.32 },
  { w: "for?", s: 36.32, e: 36.74 }, { w: "Get", s: 37.26, e: 37.38 }, { w: "the", s: 37.38, e: 37.58 },
  { w: "Dam", s: 37.58, e: 37.96 }, { w: "Class!", s: 37.96, e: 38.42 }
]

/** One line of caption: a run of spoken words, shown together and lit word by word. */
export interface Chunk {
  readonly from: number // index of the first word
  readonly to: number // index of the last word (inclusive)
  /** Words (by index) drawn in the accent colour once spoken. */
  readonly accent?: ReadonlyArray<number>
}

/** The captions under the browser, from "First," to "...a seat opens." */
export const CHUNKS: ReadonlyArray<Chunk> = [
  { from: 19, to: 24, accent: [23, 24] }, // First, head to the classes website.
  { from: 25, to: 32, accent: [28, 30] }, // Search for the class and term you need
  { from: 33, to: 37, accent: [36, 37] }, // and open the course details.
  { from: 38, to: 43, accent: [42, 43] }, // Second, scroll down to All Sections
  { from: 44, to: 48, accent: [47, 48] }, // and pick your exact section.
  { from: 49, to: 55, accent: [52] }, // Third, confirm the section at the top
  { from: 56, to: 59, accent: [58, 59] }, // and click Notify me.
  { from: 60, to: 62, accent: [62] }, // Enter your email
  { from: 63, to: 68, accent: [67, 68] }, // and type in your verification code.
  { from: 69, to: 74, accent: [74] }, // Once the button switches to Watching,
  { from: 75, to: 78, accent: [78] }, // your alert is live.
  { from: 79, to: 85, accent: [81] }, // You can manage your tracked classes anytime
  { from: 86, to: 89, accent: [88, 89] }, // in the extension pop-up,
  { from: 90, to: 95, accent: [95] }, // and you will get an email
  { from: 96, to: 100, accent: [99, 100] } // the moment a seat opens.
]

/** The small label above the caption: which of the three steps we are in. */
export interface Stage {
  readonly start: number
  readonly step: number // 1..3, or 4 once all three are done
  readonly label: string
}

export const STAGES: ReadonlyArray<Stage> = [
  { start: 6.7, step: 1, label: "Find your class" },
  { start: 13.3, step: 2, label: "Pick your section" },
  { start: 17.7, step: 3, label: "Turn on alerts" },
  { start: 25.55, step: 4, label: "You're set" }
]
