import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/client/components/ui/input-group";
import { SAM_SKILL_COMMANDS } from "@/client/features/sam/samSkillCommands";
import { cn } from "cn";

// While the message is a bare "/word", list the skills it could name.
function matchingCommands(value: string) {
  const match = /^\/([a-z-]*)$/.exec(value);
  if (!match) return [];
  return SAM_SKILL_COMMANDS.filter((command) =>
    command.name.startsWith(match[1]),
  );
}

export function ChatComposer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  /** Cancels the running turn; while busy the send button becomes Stop. */
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commands = matchingCommands(value);
  const active = commands[Math.min(highlighted, commands.length - 1)];

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  }

  function pickCommand(name: string) {
    setValue(`/${name} `);
    setHighlighted(0);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (active) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlighted(
          (commands.indexOf(active) + step + commands.length) % commands.length,
        );
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        pickCommand(active.name);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      {active ? (
        <ul
          role="listbox"
          aria-label="Skills"
          className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-md"
        >
          {commands.map((command) => (
            <li
              key={command.name}
              role="option"
              aria-selected={command === active}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-2 text-sm",
                command === active && "bg-accent",
              )}
              onMouseDown={(event) => {
                // Keep focus in the textarea.
                event.preventDefault();
                pickCommand(command.name);
              }}
            >
              <span className="font-medium">/{command.name}</span>
              <span className="ml-2 text-muted-foreground">
                {command.description}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* InputGroup dims itself when it holds a disabled control. The empty
          composer disables only Send, so keep the field at full strength. */}
      <InputGroup className="items-end rounded-xl bg-card has-disabled:bg-card has-disabled:opacity-100 dark:has-disabled:bg-input/30">
        <InputGroupTextarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Ask SAM anything, or type / to run a skill…"
          className="max-h-40 min-h-0 px-3 leading-relaxed"
        />
        <InputGroupAddon align="inline-end">
          {busy ? (
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="Stop"
              onClick={onStop}
            >
              <Square className="size-3.5 fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="rounded-full"
              aria-label="Send message"
              disabled={!value.trim()}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
