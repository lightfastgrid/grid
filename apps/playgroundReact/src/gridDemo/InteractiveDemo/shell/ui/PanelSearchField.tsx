import { IconSearch } from "../ToolbarIcons.tsx";

type PanelSearchFieldProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  id?: string;
};

/** Shared search field for toolbar panels (Columns, later others). */
export function PanelSearchField({
  value,
  placeholder,
  onChange,
  id,
}: PanelSearchFieldProps) {
  return (
    <label className="interactive-demo-panel-search" htmlFor={id}>
      <span className="interactive-demo-panel-search-icon" aria-hidden="true">
        <IconSearch />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
