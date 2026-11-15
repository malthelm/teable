import { Selector } from '@teable/ui-lib/base';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import type { Rank } from './radio-data';

export function RadioFilter({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Rank[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Selector
        ariaLabel={label}
        selectedId={value || 'all'}
        className="h-8 w-full min-w-0 px-2 text-sm"
        contentClassName="max-w-[min(360px,calc(100vw-32px))]"
        candidates={[
          {
            id: 'all',
            name: `All ${label === 'Country' ? 'countries' : label.toLowerCase() + 's'}`,
          },
          ...items.map((item) => ({ id: item.key, name: item.label })),
        ]}
        searchTip={`Search ${label.toLowerCase()}…`}
        emptyTip="No matches"
        onChange={(next) => onChange(next === 'all' ? '' : next)}
      />
    </div>
  );
}

export function RadioPeriod({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor="radio-period" className="text-muted-foreground text-xs">
        Period
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="radio-period" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="30">Latest available 30 days</SelectItem>
          <SelectItem value="90">Latest available 90 days</SelectItem>
          <SelectItem value="all">All imported plays</SelectItem>
          <SelectItem value="custom">Custom dates</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
