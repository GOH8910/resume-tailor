"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/ui/Button";

type Props = {
  /** Singular name used in labels, e.g. "bullet" or "entry". */
  noun: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  /** Ask "Delete {noun}?" inline before deleting. */
  confirmDelete?: boolean;
};

/** Up / down / delete buttons for one row of a list. Renders a fragment so the parent controls the layout. */
export function ReorderControls({ noun, index, count, onMove, onDelete, confirmDelete = false }: Props) {
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<-1 | 1 | null>(null);
  const refocusDelete = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const questionId = useId();

  // Moving re-renders this row at a new index and the browser can drop focus with the moved node.
  // Put it back on the arrow that was pressed, or on the other arrow when this row is now at an end.
  useEffect(() => {
    if (pressed.current === null) return;
    const [wanted, other] = pressed.current === -1 ? [upRef.current, downRef.current] : [downRef.current, upRef.current];
    (wanted?.disabled ? other : wanted)?.focus();
    pressed.current = null;
  }, [index]);

  // The delete button is unmounted while confirming, so focus returns to it after the next render.
  useEffect(() => {
    if (confirming || !refocusDelete.current) return;
    refocusDelete.current = false;
    deleteRef.current?.focus();
  }, [confirming]);

  const move = (direction: -1 | 1) => {
    pressed.current = direction;
    onMove(direction);
  };

  const cancel = () => {
    refocusDelete.current = true;
    setConfirming(false);
  };

  return (
    <>
      <Button ref={upRef} size="sm" variant="ghost" aria-label={`Move ${noun} up`} disabled={index === 0} onClick={() => move(-1)}>
        ↑
      </Button>
      <Button ref={downRef} size="sm" variant="ghost" aria-label={`Move ${noun} down`} disabled={index === count - 1} onClick={() => move(1)}>
        ↓
      </Button>
      {confirming ? (
        <>
          <span id={questionId} className="text-xs text-ink-soft">
            Delete {noun}?
          </span>
          <Button size="sm" variant="danger" aria-describedby={questionId} onClick={onDelete}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" autoFocus aria-describedby={questionId} onClick={cancel}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          ref={deleteRef}
          size="sm"
          variant="danger"
          aria-label={`Delete ${noun}`}
          onClick={confirmDelete ? () => setConfirming(true) : onDelete}
        >
          {confirmDelete ? "Delete" : "✕"}
        </Button>
      )}
    </>
  );
}
