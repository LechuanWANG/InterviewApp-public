export function CouncilStyles() {
  return (
    <style jsx global>{`
      @keyframes councilFadeIn {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.98);
          filter: blur(3px);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
        }
      }

      .council-fade-in {
        animation: councilFadeIn 0.45s ease-out both;
      }

      .council-page-fade-out {
        animation: councilPageFadeOut 1.25s ease-in-out both;
      }

      .council-interview-fade-in {
        animation: councilInterviewFadeIn 1.05s ease-out both;
      }

      .council-thinking-hint {
        animation: councilThinkingHint 0.62s ease-out both;
      }

      .council-center-primary {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 5;
        max-height: 7.5rem;
        overflow: hidden;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .council-center-primary-full {
        max-height: none;
        overflow: visible;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .council-thinking-orbit {
        animation: councilThinkingSpin 1.4s linear infinite;
        filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.28));
      }

      .council-thinking-orbit-reverse {
        animation: councilThinkingSpinReverse 1.9s linear infinite;
        filter: drop-shadow(0 0 8px rgba(14, 165, 233, 0.24));
      }

      .council-thinking-scan {
        animation: councilThinkingScan 1.25s ease-in-out infinite;
      }

      .council-thinking-scan-line {
        animation: councilThinkingScanLine 1.25s ease-in-out infinite;
        transform-origin: center;
      }

      .council-thinking-frame-accent {
        animation: councilThinkingFrameTrace 1.65s ease-in-out infinite;
        filter: drop-shadow(0 0 7px currentColor);
        stroke-dasharray: 190;
        stroke-dashoffset: 190;
      }

      .council-thinking-dot-orbit {
        animation: councilThinkingSpin 1.8s linear infinite;
        transform-box: fill-box;
        transform-origin: center;
      }

      .council-thinking-host-weave {
        stroke-dasharray: 54;
        stroke-dashoffset: 54;
        animation: councilThinkingHostWeave 1.55s ease-in-out infinite;
      }

      .council-thinking-host-weave-delay {
        animation-delay: 0.22s;
      }

      .council-thinking-host-node {
        animation: councilThinkingHostNode 1.2s ease-in-out infinite;
      }

      .council-thinking-host-node-delay {
        animation-delay: 0.18s;
      }

      .council-thinking-path {
        stroke-dasharray: 72;
        stroke-dashoffset: 72;
        animation: councilThinkingPath 1.45s ease-in-out infinite;
      }

      .council-thinking-alert {
        animation: councilThinkingAlert 0.9s ease-in-out infinite;
      }

      @keyframes councilThinkingSpin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes councilThinkingSpinReverse {
        to {
          transform: rotate(-360deg);
        }
      }

      @keyframes councilThinkingScan {
        0%, 100% {
          top: 0.35rem;
          opacity: 0.25;
        }
        50% {
          top: 2.15rem;
          opacity: 0.8;
        }
      }

      @keyframes councilThinkingScanLine {
        0%, 100% {
          transform: translateY(0);
          opacity: 0.22;
        }
        50% {
          transform: translateY(1.75rem);
          opacity: 0.75;
        }
      }

      @keyframes councilThinkingFrameTrace {
        0% {
          stroke-dashoffset: 190;
          opacity: 0.22;
        }
        55% {
          stroke-dashoffset: 0;
          opacity: 0.86;
        }
        100% {
          stroke-dashoffset: -190;
          opacity: 0.22;
        }
      }

      @keyframes councilThinkingHostWeave {
        0% {
          stroke-dashoffset: 54;
          opacity: 0.22;
        }
        55% {
          stroke-dashoffset: 0;
          opacity: 0.88;
        }
        100% {
          stroke-dashoffset: -54;
          opacity: 0.22;
        }
      }

      @keyframes councilThinkingHostNode {
        0%, 100% {
          opacity: 0.36;
          transform: scale(0.94);
        }
        50% {
          opacity: 0.84;
          transform: scale(1.08);
        }
      }

      @keyframes councilThinkingPath {
        0% {
          stroke-dashoffset: 72;
          opacity: 0.45;
        }
        55% {
          stroke-dashoffset: 0;
          opacity: 1;
        }
        100% {
          stroke-dashoffset: -72;
          opacity: 0.45;
        }
      }

      @keyframes councilThinkingAlert {
        0%, 100% {
          opacity: 0.45;
        }
        50% {
          opacity: 1;
        }
      }

      @keyframes councilThinkingHint {
        from {
          opacity: 0;
          transform: translateY(6px);
          filter: blur(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
        }
      }

      @keyframes councilPageFadeOut {
        0%, 34% {
          opacity: 1;
          transform: scale(1);
          filter: blur(0);
        }
        72% {
          opacity: 0.7;
          transform: scale(0.992);
          filter: blur(2px);
        }
        100% {
          opacity: 0.08;
          transform: scale(0.985);
          filter: blur(7px);
        }
      }

      @keyframes councilInterviewFadeIn {
        0% {
          opacity: 0;
          transform: translateY(16px) scale(0.992);
          filter: blur(8px);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
        }
      }
    `}</style>
  );
}
