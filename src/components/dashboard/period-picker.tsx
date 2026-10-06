"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { ChevronIcon } from "@/components/dashboard/icons";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  formatCalendarDate,
  formatCalendarDateLong,
  inclusiveDays,
  isWithinRange,
  monthLabel,
  MONTH_LABELS,
  startOfMonth,
  WEEKDAY_LABELS,
} from "@/lib/dashboard/calendar";
import {
  COMPARISON_WINDOW_LABELS,
  resolveComparisonRange,
  type ComparisonWindow,
} from "@/lib/dashboard/search-terms";
import {
  PREVIEW_REFERENCE_DATE,
  resolveTimeframe,
  TIMEFRAME_PRESETS,
  matchTimeframe,
} from "@/lib/dashboard/timeframes";
import type { DateRange } from "@/lib/dashboard/types";
import { MAX_RANGE_DAYS } from "@/lib/dashboard/validation";

/** What the picker hands back once the reader presses Update. */
export interface PeriodSelection {
  range: DateRange;
  /** Preset key, or an empty string when the dates are a custom range. */
  preset: string;
  /** False when the reader unticked Compare; no delta is then reported. */
  comparisonEnabled: boolean;
  comparisonWindow: ComparisonWindow;
  /** Only set when the window is "custom"; otherwise the window resolves it. */
  comparisonRange: DateRange | null;
}

interface PeriodPickerProps {
  /** The applied active period, shown on the trigger and reset to on cancel. */
  activeRange: DateRange;
  comparisonEnabled: boolean;
  comparisonWindow: ComparisonWindow;
  /** The applied baseline, already resolved by the server. */
  comparisonRange: DateRange;
  /** The reader's own baseline dates, kept so reopening restores them. */
  customComparisonRange: DateRange | null;
  /** The account's "today". Preview data is anchored to a fixed day. */
  referenceDate?: string;
  disabled?: boolean;
  /** Shows the high-frequency paid-media ranges as one-click pills. */
  quickPresets?: boolean;
  onApply: (selection: PeriodSelection) => void;
}

const QUICK_PRESETS = [
  { key: "7d", label: "7D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "this-month", label: "MTD" },
] as const;

const PRESET_GROUPS = [
  ...new Set(TIMEFRAME_PRESETS.map((preset) => preset.group)),
];

const COMPARISON_WINDOWS = Object.keys(
  COMPARISON_WINDOW_LABELS,
) as ComparisonWindow[];

const CALENDAR_YEAR_SPAN = { first: 2024, last: 2027 };

function presetLabel(key: string): string {
  return (
    TIMEFRAME_PRESETS.find((preset) => preset.key === key)?.label ??
    "Custom range"
  );
}

function describeRange(range: DateRange): string {
  return `${formatCalendarDate(range.start)} – ${formatCalendarDate(range.end)}`;
}

function clampToSpan(month: string): string {
  const year = Number(month.slice(0, 4));
  if (year < CALENDAR_YEAR_SPAN.first) return `${CALENDAR_YEAR_SPAN.first}-01-01`;
  if (year > CALENDAR_YEAR_SPAN.last) return `${CALENDAR_YEAR_SPAN.last}-12-01`;
  return month;
}

export function PeriodPicker({
  activeRange,
  comparisonEnabled,
  comparisonWindow,
  comparisonRange,
  customComparisonRange,
  referenceDate = PREVIEW_REFERENCE_DATE,
  disabled = false,
  quickPresets = false,
  onApply,
}: PeriodPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(activeRange);
  const [preset, setPreset] = useState(
    () => matchTimeframe(activeRange, referenceDate) ?? "",
  );
  const [compareOn, setCompareOn] = useState(comparisonEnabled);
  const [window, setWindow] = useState<ComparisonWindow>(comparisonWindow);
  const [customCompare, setCustomCompare] = useState<DateRange>(
    customComparisonRange ?? comparisonRange,
  );
  /** The first click of a two-click range; null once the range is complete. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [leftMonth, setLeftMonth] = useState(() =>
    clampToSpan(addMonths(startOfMonth(activeRange.end), -1)),
  );
  const [focusedDay, setFocusedDay] = useState(activeRange.end);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set while a keyboard user is walking the grid, so focus follows them. */
  const shouldFocusDay = useRef(false);

  const dialogId = useId();
  const comparisonSettingsId = useId();
  const noteId = useId();

  const appliedPreset = useMemo(
    () => matchTimeframe(activeRange, referenceDate) ?? "",
    [activeRange, referenceDate],
  );

  const draftDays = useMemo(
    () => (draft.start <= draft.end ? inclusiveDays(draft) : 0),
    [draft],
  );

  const draftComparison = useMemo(
    () =>
      draft.start <= draft.end
        ? resolveComparisonRange(draft, window, customCompare)
        : comparisonRange,
    [draft, window, customCompare, comparisonRange],
  );

  const previewRange = useMemo<DateRange | null>(() => {
    if (anchor === null) return null;
    const candidate = hoveredDay ?? focusedDay;
    return candidate < anchor
      ? { start: candidate, end: anchor }
      : { start: anchor, end: candidate };
  }, [anchor, focusedDay, hoveredDay]);

  const validation = useMemo(() => {
    if (draft.start > draft.end) {
      return "Start date must be on or before end date.";
    }
    if (draftDays > MAX_RANGE_DAYS) {
      return `This dashboard reads at most ${MAX_RANGE_DAYS} days at a time. Shorten the active period.`;
    }
    if (compareOn && window === "custom") {
      if (customCompare.start > customCompare.end) {
        return "Comparison start date must be on or before its end date.";
      }
      if (inclusiveDays(customCompare) > MAX_RANGE_DAYS) {
        return `The comparison period is also capped at ${MAX_RANGE_DAYS} days.`;
      }
    }
    return null;
  }, [draft, draftDays, compareOn, window, customCompare]);

  const resetDraft = useCallback(() => {
    setDraft(activeRange);
    setPreset(appliedPreset);
    setCompareOn(comparisonEnabled);
    setWindow(comparisonWindow);
    setCustomCompare(customComparisonRange ?? comparisonRange);
    setAnchor(null);
    setHoveredDay(null);
    setLeftMonth(clampToSpan(addMonths(startOfMonth(activeRange.end), -1)));
    setFocusedDay(activeRange.end);
  }, [
    activeRange,
    appliedPreset,
    comparisonEnabled,
    comparisonWindow,
    comparisonRange,
    customComparisonRange,
  ]);

  const close = useCallback(
    (returnFocus: boolean) => {
      setIsOpen(false);
      shouldFocusDay.current = false;
      setHoveredDay(null);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  /** Reopening always starts from what is applied, so an abandoned draft
   *  never leaks into the next visit. */
  function open() {
    resetDraft();
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, close]);

  /**
   * Keep the compact tray inside the viewport without ever flipping it above
   * the reporting-period control. When the reader opens it low on the page,
   * move the page just enough to reveal the tray below the trigger.
   */
  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    function clampToViewport(revealBelow = false) {
      const panel = panelRef.current;
      const host = containerRef.current;
      const trigger = triggerRef.current;
      if (!panel || !host || !trigger) return;

      panel.style.marginLeft = "0px";
      panel.style.top = "calc(100% + 10px)";
      panel.style.bottom = "auto";
      panel.style.maxHeight = "";
      panel.style.transformOrigin = "top left";

      const margin = 16;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;

      if (globalThis.matchMedia("(max-width: 620px)").matches) {
        panel.style.top = `${margin}px`;
        panel.style.bottom = "auto";
        panel.style.transformOrigin = "center";
        panel.style.maxHeight = `${viewportHeight - margin * 2}px`;
        return;
      }

      const room =
        viewportWidth - margin - panel.offsetWidth;
      const overflow = room - host.getBoundingClientRect().left;
      panel.style.marginLeft = `${Math.min(0, overflow)}px`;

      const triggerRect = trigger.getBoundingClientRect();
      const gap = 10;
      const naturalHeight = panel.scrollHeight;
      const desiredHeight = naturalHeight;
      const roomBelow = viewportHeight - triggerRect.bottom - gap - margin;
      const safeTop = margin;
      const scrollCapacity = Math.max(0, triggerRect.top - safeTop);
      const scrollNeeded = Math.max(0, desiredHeight - roomBelow);

      if (revealBelow && scrollNeeded > 0 && scrollCapacity > 0) {
        globalThis.scrollBy({
          behavior: "auto",
          top: Math.min(scrollNeeded, scrollCapacity),
        });
      }

      panel.style.maxHeight = "none";
    }

    const onResize = () => clampToViewport(false);

    clampToViewport(true);
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
  }, [isOpen]);

  // The panel is a dialog, so focus starts inside it and Tab stays inside it
  // until the reader cancels or updates.
  useEffect(() => {
    if (!isOpen) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      '[data-autofocus="true"]',
    );
    first?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !shouldFocusDay.current) return;
    const cell = panelRef.current?.querySelector<HTMLElement>(
      `[data-day="${focusedDay}"]`,
    );
    cell?.focus();
    shouldFocusDay.current = false;
  }, [isOpen, focusedDay]);

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) return;

    const focusable = [
      ...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    ].filter((element) => element.tabIndex !== -1);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showMonthFor(date: string) {
    const month = startOfMonth(date);
    const rightMonth = addMonths(leftMonth, 1);
    if (month < leftMonth || month > rightMonth) {
      setLeftMonth(clampToSpan(addMonths(month, -1)));
    }
  }

  function choosePreset(key: string) {
    if (key === "") {
      // "Custom" keeps the dates already on screen and hands control to the
      // calendar instead of jumping the reader somewhere unexpected.
      setPreset("");
      setAnchor(null);
      setHoveredDay(null);
      return;
    }

    const range = resolveTimeframe(key, referenceDate);
    if (!range) return;

    setPreset(key);
    setDraft(range);
    setAnchor(null);
    setHoveredDay(null);
    setFocusedDay(range.end);
    setLeftMonth(clampToSpan(addMonths(startOfMonth(range.end), -1)));
  }

  function chooseDay(day: string) {
    setPreset("");

    if (anchor === null) {
      setAnchor(day);
      setDraft({ start: day, end: day });
      setFocusedDay(day);
      setHoveredDay(day);
      return;
    }

    setAnchor(null);
    setHoveredDay(null);
    setDraft(
      day < anchor ? { start: day, end: anchor } : { start: anchor, end: day },
    );
  }

  /**
   * Days after the reference day and outside the calendar span are disabled,
   * and a disabled button cannot take focus. Arrow keys are clamped to the
   * selectable span so keyboard navigation never drops focus to the body.
   */
  function moveFocusToDay(candidate: string) {
    const floor = `${CALENDAR_YEAR_SPAN.first}-01-01`;
    const iso =
      candidate > referenceDate
        ? referenceDate
        : candidate < floor
          ? floor
          : candidate;

    shouldFocusDay.current = true;
    setFocusedDay(iso);
    showMonthFor(iso);
  }

  function onDayKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, day: string) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = moves[event.key];

    if (step !== undefined) {
      event.preventDefault();
      moveFocusToDay(addDays(day, step));
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      moveFocusToDay(
        addDays(day, event.key === "Home" ? -weekday : 6 - weekday),
      );
      return;
    }

    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      moveFocusToDay(addMonths(day, event.key === "PageUp" ? -1 : 1));
    }
  }

  /**
   * Editing a baseline date turns the window into a custom one, the way Meta
   * does: the two date columns are always live, and touching them is how a
   * reader leaves a preset behind.
   */
  function editCompareDate(part: "start" | "end", value: string) {
    const base = window === "custom" ? customCompare : draftComparison;
    setWindow("custom");
    setCustomCompare({ ...base, [part]: value });
  }

  function submit() {
    if (validation) return;
    onApply({
      range: draft,
      preset,
      comparisonEnabled: compareOn,
      comparisonWindow: window,
      comparisonRange:
        compareOn && window === "custom" ? customCompare : null,
    });
    close(true);
  }

  function applyQuickPreset(key: (typeof QUICK_PRESETS)[number]["key"]) {
    const range = resolveTimeframe(key, referenceDate);
    if (!range) return;

    close(false);
    onApply({
      range,
      preset: key,
      comparisonEnabled,
      comparisonWindow,
      comparisonRange:
        comparisonEnabled && comparisonWindow === "custom"
          ? customComparisonRange ?? comparisonRange
          : null,
    });
  }

  const rightMonth = addMonths(leftMonth, 1);
  const canPage = {
    back: leftMonth > `${CALENDAR_YEAR_SPAN.first}-01-01`,
    forward: rightMonth < `${CALENDAR_YEAR_SPAN.last}-12-01`,
  };

  return (
    <div
      className={`period-picker${quickPresets ? " period-picker--quick" : ""}`}
      ref={containerRef}
    >
      {quickPresets && (
        <div
          aria-label="Quick reporting periods"
          className="period-picker__quick-presets"
          role="group"
        >
          {QUICK_PRESETS.map((item) => (
            <button
              aria-pressed={appliedPreset === item.key}
              className="period-picker__quick-button"
              disabled={disabled}
              key={item.key}
              onClick={() => applyQuickPreset(item.key)}
              title={presetLabel(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        aria-controls={isOpen ? dialogId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Reporting period: ${presetLabel(appliedPreset)}, ${describeRange(activeRange)}. ${
          comparisonEnabled
            ? `Compared with ${COMPARISON_WINDOW_LABELS[comparisonWindow].toLowerCase()}.`
            : "Comparison is off."
        }`}
        className={`period-picker__trigger${
          quickPresets ? " period-picker__trigger--custom" : ""
        }${
          quickPresets && appliedPreset === ""
            ? " period-picker__trigger--active"
            : ""
        }`}
        disabled={disabled}
        onClick={() => (isOpen ? close(true) : open())}
        ref={triggerRef}
        type="button"
      >
        <span className="period-picker__trigger-label">
          {quickPresets ? "Custom" : "Reporting period"}
        </span>
        <span className="period-picker__trigger-value">
          <strong>
            {quickPresets ? "Custom" : presetLabel(appliedPreset)}
          </strong>
          <small>{describeRange(activeRange)}</small>
        </span>
        <span
          className={`period-picker__trigger-compare ${
            comparisonEnabled ? "" : "is-off"
          }`}
        >
          {comparisonEnabled
            ? `vs ${COMPARISON_WINDOW_LABELS[comparisonWindow].toLowerCase()}`
            : "no comparison"}
        </span>
        <ChevronIcon />
      </button>

      {isOpen && (
        <div
          aria-describedby={noteId}
          aria-label="Reporting period"
          aria-modal="true"
          className="period-picker__panel"
          id={dialogId}
          onKeyDown={onPanelKeyDown}
          ref={panelRef}
          role="dialog"
        >
          <div className="period-picker__body">
            <fieldset className="period-presets">
              <legend>Active period preset</legend>
              <div className="period-presets__list">
                {PRESET_GROUPS.map((group) => (
                  <div className="period-presets__group" key={group}>
                    <span className="period-presets__group-label">{group}</span>
                    {TIMEFRAME_PRESETS.filter(
                      (item) => item.group === group,
                    ).map((item) => (
                      <label className="period-preset" key={item.key}>
                        <input
                          checked={preset === item.key}
                          data-autofocus={
                            preset === item.key ? "true" : undefined
                          }
                          name={`${dialogId}-preset`}
                          onChange={() => choosePreset(item.key)}
                          type="radio"
                          value={item.key}
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
                <div className="period-presets__group">
                  <span className="period-presets__group-label">Manual</span>
                  <label className="period-preset">
                    <input
                      checked={preset === ""}
                      data-autofocus={preset === "" ? "true" : undefined}
                      name={`${dialogId}-preset`}
                      onChange={() => choosePreset("")}
                      type="radio"
                      value=""
                    />
                    <span>Custom range</span>
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="period-calendar">
              <div
                className="period-calendar__months"
                onMouseLeave={() => setHoveredDay(null)}
              >
                <button
                  aria-label="Show earlier months"
                  className="period-calendar__page"
                  disabled={!canPage.back}
                  onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                  type="button"
                >
                  <ChevronIcon />
                </button>

                {[leftMonth, rightMonth].map((month) => (
                  <MonthPane
                    anchor={anchor}
                    comparison={compareOn ? draftComparison : null}
                    focusedDay={focusedDay}
                    key={month}
                    month={month}
                    onKeyDown={onDayKeyDown}
                    onSelect={chooseDay}
                    onPreview={setHoveredDay}
                    onMonthChange={(next) => {
                      const shifted =
                        month === leftMonth ? next : addMonths(next, -1);
                      setLeftMonth(clampToSpan(shifted));
                    }}
                    range={draft}
                    previewRange={previewRange}
                    referenceDate={referenceDate}
                  />
                ))}

                <button
                  aria-label="Show later months"
                  className="period-calendar__page period-calendar__page--forward"
                  disabled={!canPage.forward}
                  onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                  type="button"
                >
                  <ChevronIcon />
                </button>
              </div>

              <p className="period-calendar__legend">
                <span className="period-legend period-legend--active">
                  Active period
                </span>
                {compareOn && (
                  <span className="period-legend period-legend--comparison">
                    Comparison period
                  </span>
                )}
                <span className="period-calendar__count">
                  {draftDays > 0
                    ? `${draftDays} day${draftDays === 1 ? "" : "s"} selected`
                    : "Range not valid yet"}
                </span>
              </p>

              <div className="period-rows">
                <div className="period-row">
                  <span className="period-row__title">
                    <b>Active period</b>
                    <small>{presetLabel(preset)}</small>
                  </span>
                  <label className="period-row__field">
                    <span>Start date</span>
                    <input
                      onChange={(event) => {
                        setPreset("");
                        setAnchor(null);
                        setDraft((current) => ({
                          ...current,
                          start: event.target.value,
                        }));
                        if (event.target.value) showMonthFor(event.target.value);
                      }}
                      type="date"
                      value={draft.start}
                    />
                  </label>
                  <label className="period-row__field">
                    <span>End date</span>
                    <input
                      onChange={(event) => {
                        setPreset("");
                        setAnchor(null);
                        setDraft((current) => ({
                          ...current,
                          end: event.target.value,
                        }));
                        if (event.target.value) showMonthFor(event.target.value);
                      }}
                      type="date"
                      value={draft.end}
                    />
                  </label>
                </div>

                <div
                  className={`period-row period-row--comparison ${
                    compareOn ? (window === "custom" ? "is-custom" : "") : "is-off"
                  }`}
                >
                  <label className="period-row__toggle">
                    <input
                      aria-controls={`${comparisonSettingsId}-window ${comparisonSettingsId}-start ${comparisonSettingsId}-end`}
                      aria-expanded={compareOn}
                      aria-label="Enable period comparison"
                      checked={compareOn}
                      onChange={(event) => setCompareOn(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="period-row__title">
                      <b>Compare</b>
                      <small>
                        {!compareOn
                          ? "Off · this period is reported on its own"
                          : draftDays > 0 &&
                              inclusiveDays(draftComparison) !== draftDays
                            ? `Normalised to ${draftDays} days`
                            : "Like-for-like length"}
                      </small>
                    </span>
                  </label>
                  <label className="period-row__field period-row__field--window">
                    <span>Baseline</span>
                    <span className="select-wrap">
                      <select
                        disabled={!compareOn}
                        id={`${comparisonSettingsId}-window`}
                        onChange={(event) => {
                          const next = event.target.value as ComparisonWindow;
                          setWindow(next);
                          if (next === "custom") {
                            setCustomCompare(draftComparison);
                          }
                        }}
                        value={window}
                      >
                        {COMPARISON_WINDOWS.map((item) => (
                          <option key={item} value={item}>
                            {COMPARISON_WINDOW_LABELS[item]}
                          </option>
                        ))}
                      </select>
                      <ChevronIcon />
                    </span>
                  </label>
                  <label className="period-row__field">
                    <span>Baseline start</span>
                    <input
                      disabled={!compareOn}
                      id={`${comparisonSettingsId}-start`}
                      onChange={(event) =>
                        editCompareDate("start", event.target.value)
                      }
                      type="date"
                      value={
                        window === "custom"
                          ? customCompare.start
                          : draftComparison.start
                      }
                    />
                  </label>
                  <label className="period-row__field">
                    <span>Baseline end</span>
                    <input
                      disabled={!compareOn}
                      id={`${comparisonSettingsId}-end`}
                      onChange={(event) =>
                        editCompareDate("end", event.target.value)
                      }
                      type="date"
                      value={
                        window === "custom"
                          ? customCompare.end
                          : draftComparison.end
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="period-picker__footer">
            <p
              aria-atomic="true"
              aria-live="polite"
              className="period-picker__note"
              id={noteId}
            >
              {validation ??
                (anchor
                  ? `${formatCalendarDateLong(anchor)} selected as the first boundary. Choose the other boundary.`
                  : compareOn
                  ? "Editing a baseline date switches the comparison to a custom period."
                  : "With compare off, every period-over-period figure is withheld rather than measured against an unchosen baseline.")}
            </p>
            <div className="period-picker__actions">
              <button
                className="button button--secondary"
                onClick={() => close(true)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={validation !== null}
                onClick={submit}
                type="button"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthPane({
  anchor,
  comparison,
  focusedDay,
  month,
  onKeyDown,
  onMonthChange,
  onPreview,
  onSelect,
  previewRange,
  range,
  referenceDate,
}: {
  anchor: string | null;
  /** Null while comparison is switched off, so no baseline is painted. */
  comparison: DateRange | null;
  focusedDay: string;
  month: string;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    day: string,
  ) => void;
  onMonthChange: (month: string) => void;
  onPreview: (day: string) => void;
  onSelect: (day: string) => void;
  previewRange: DateRange | null;
  range: DateRange;
  referenceDate: string;
}) {
  const weeks = useMemo(() => buildMonthGrid(month), [month]);
  const captionId = useId();
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const year = Number(month.slice(0, 4));
  const hasValidRange = range.start <= range.end;

  const years = Array.from(
    { length: CALENDAR_YEAR_SPAN.last - CALENDAR_YEAR_SPAN.first + 1 },
    (_, index) => CALENDAR_YEAR_SPAN.first + index,
  );

  return (
    <div className="period-month">
      <div className="period-month__head">
        <label className="period-month__select">
          <span className="visually-hidden">Month</span>
          <span className="select-wrap">
            <select
              onChange={(event) =>
                onMonthChange(
                  `${year}-${String(Number(event.target.value) + 1).padStart(2, "0")}-01`,
                )
              }
              value={monthIndex}
            >
              {MONTH_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
        </label>
        <label className="period-month__select">
          <span className="visually-hidden">Year</span>
          <span className="select-wrap">
            <select
              onChange={(event) =>
                onMonthChange(
                  `${event.target.value}-${String(monthIndex + 1).padStart(2, "0")}-01`,
                )
              }
              value={year}
            >
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
        </label>
      </div>

      <table aria-labelledby={captionId} className="period-month__grid">
        <caption className="visually-hidden" id={captionId}>
          {monthLabel(month)}
        </caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((weekday) => (
              <th key={weekday} scope="col">
                <span aria-hidden="true">{weekday.slice(0, 2)}</span>
                <span className="visually-hidden">{weekday}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={`${month}-${weekIndex}`}>
              {week.map((day, dayIndex) => {
                if (day === null) {
                  return <td key={`${month}-${weekIndex}-${dayIndex}`} />;
                }

                const inActive = hasValidRange && isWithinRange(day, range);
                const inComparison =
                  comparison !== null && isWithinRange(day, comparison);
                const inPreview =
                  previewRange !== null && isWithinRange(day, previewRange);
                const isEdge =
                  day === range.start || day === range.end || day === anchor;
                const isComparisonEdge =
                  comparison !== null &&
                  (day === comparison.start || day === comparison.end);
                const isFuture = day > referenceDate;

                const state = [
                  inActive ? "is-active" : "",
                  isEdge && hasValidRange ? "is-edge" : "",
                  day === range.start ? "is-range-start" : "",
                  day === range.end ? "is-range-end" : "",
                  inComparison ? "is-comparison" : "",
                  isComparisonEdge ? "is-comparison-edge" : "",
                  comparison !== null && day === comparison.start
                    ? "is-comparison-start"
                    : "",
                  comparison !== null && day === comparison.end
                    ? "is-comparison-end"
                    : "",
                  inPreview ? "is-preview" : "",
                  previewRange !== null && day === previewRange.start
                    ? "is-preview-start"
                    : "",
                  previewRange !== null && day === previewRange.end
                    ? "is-preview-end"
                    : "",
                  day === referenceDate ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <td key={day}>
                    <button
                      aria-current={day === referenceDate ? "date" : undefined}
                      aria-label={`${formatCalendarDateLong(day)}${
                        inActive ? ", in active period" : ""
                      }${inComparison ? ", in comparison period" : ""}${
                        isFuture ? ", no data yet" : ""
                      }`}
                      aria-pressed={inActive}
                      className={`period-day ${state}`}
                      data-day={day}
                      disabled={isFuture}
                      onClick={() => onSelect(day)}
                      onKeyDown={(event) => onKeyDown(event, day)}
                      onMouseEnter={() => {
                        if (!isFuture) onPreview(day);
                      }}
                      tabIndex={day === focusedDay ? 0 : -1}
                      type="button"
                    >
                      <span aria-hidden="true">{Number(day.slice(8, 10))}</span>
                      <span className="visually-hidden">
                        {formatCalendarDateLong(day)}
                        {inComparison ? ", in comparison period" : ""}
                        {isFuture ? ", no data yet" : ""}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kept beside the picker so the trigger and summary agree on wording. */
export { describeRange as describePeriodRange };
