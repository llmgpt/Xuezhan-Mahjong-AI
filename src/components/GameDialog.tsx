import { useId, useRef, type ReactNode } from "react";

export function GameDialog({
  title,
  trigger,
  triggerClassName = "textButton",
  children,
}: {
  title: string;
  trigger?: string;
  triggerClassName?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {trigger ?? title}
      </button>
      <dialog
        className="gameDialog"
        ref={dialog}
        aria-labelledby={headingId}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.target === event.currentTarget &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
          )
            event.currentTarget.close();
        }}
      >
        <header className="dialogHeading">
          <h2 id={headingId}>{title}</h2>
          <form method="dialog">
            <button type="submit" className="dialogClose" aria-label="关闭">
              ×
            </button>
          </form>
        </header>
        <div className="dialogContent">{children}</div>
      </dialog>
    </>
  );
}
