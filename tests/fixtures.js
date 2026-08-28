export const esLocale = {
  id: "es-ES",
  dir: "ltr",
  ui: {
    gameName: "Nexo",
    gameLabel: "Pistas anidadas",
    puzzleLabel: "Rompecabezas",
    clueCount: "{count} pistas",
    instructions: "Pulsa para obtener pistas, pero escribe cada respuesta para continuar.",
    guessLabel: "Respuesta",
    guessPlaceholder: "Escribe cualquier respuesta",
    submit: "Enviar",
    peek: "Mostrar la primera letra.",
    enterAfterPeek: "Escribe la respuesta para continuar.",
    peekValue: "Primera letra: {peek}.",
    peekMarker: " · {peek}…",
    clueLabel: "Pista: {clue}.",
    showKeyboard: "Mostrar teclado",
    hideKeyboard: "Ocultar teclado",
    virtualKeyboard: "Teclado español",
    space: "Espacio",
    backspace: "Borrar",
    score: "Puntuación",
    scoreValue: "Puntuación: {score}.",
    completionTitle: "Nexo resuelto",
    result: "{score} puntos · {rank}",
    rankPerfect: "Precisión total",
    rankSharp: "Mente aguda",
    rankSteady: "Paso firme"
  },
  matching: {
    locale: "es-ES",
    foldCase: true,
    trim: true,
    collapseWhitespace: true,
    canonicalizeQuotes: true,
    canonicalizeHyphens: true,
    optionalAcuteVowels: true,
    ignorePunctuation: false
  },
  keyboard: {
    mode: "native-preferred",
    rows: [["a", "ñ"]],
    extras: ["á", " "]
  }
};

export const branchPuzzle = {
  schemaVersion: 1,
  id: "branch-es",
  revision: 3,
  locale: "es-ES",
  title: "Ramas",
  releaseDate: "2026-08-28",
  finalText: "El libro azul.",
  root: ["El ", { ref: "object" }, "."],
  clues: {
    object: {
      answer: "libro azul",
      prompt: [{ ref: "book" }, " ", { ref: "colour" }]
    },
    book: {
      answer: "libro",
      accept: ["volumen"],
      prompt: [{ ref: "lib" }, "ro"]
    },
    lib: {
      answer: "lib",
      prompt: ["inicio de una palabra para una obra encuadernada"]
    },
    colour: {
      answer: "azul",
      prompt: ["color del ", { ref: "sky" }]
    },
    sky: {
      answer: "cielo",
      prompt: ["lo que vemos sobre nosotros"]
    }
  }
};

export function freshBranch() {
  return structuredClone(branchPuzzle);
}
