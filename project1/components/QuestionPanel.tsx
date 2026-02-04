import React from "react";

interface Question {
  _id: string;
}

interface QuestionPanelProps {
  questions: Question[];
  currentIndex: number;
  answersMap: Map<string, number>;
  onJump: (index: number) => void;
}

export default function QuestionPanel({ questions, currentIndex, answersMap, onJump }: QuestionPanelProps) {
  return (
    <div className="w-60 border-r border-zinc-200 p-4 h-screen overflow-auto bg-gradient-to-b from-blue-200 via-rose-200 to-sky-300">
      <div className="mb-3 font-bold text-zinc-900">Questions</div>

      <div className="grid grid-cols-3 gap-2">
        {questions.map((q: Question, idx: number) => {
          const answered = answersMap.has(q._id);
          const isActive = idx === currentIndex;

          return (
            <button
              key={q._id}
              onClick={() => onJump(idx)}
              className={[
                "h-11 rounded-xl border-2 font-bold transition",
                isActive ? "border-zinc-900" : "border-zinc-300",
                answered ? "bg-zinc-900 text-white" : "bg-white text-zinc-900",
                "hover:bg-zinc-50"
              ].join(" ")}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

