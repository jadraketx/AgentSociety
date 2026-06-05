import * as React from 'react';
import { AutoComplete } from 'antd';
import type { ClaudeModelOption } from './claudeCodeTypes';

export interface ClaudeModelSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  models: ClaudeModelOption[];
  placeholder: string;
  disabled?: boolean;
}

export const ClaudeModelSelect: React.FC<ClaudeModelSelectProps> = ({
  value,
  onChange,
  models,
  placeholder,
  disabled,
}) => {
  const options = React.useMemo(
    () =>
      models.map((m) => ({
        value: m.id,
        label: m.label ? `${m.label} (${m.id})` : m.id,
      })),
    [models]
  );

  return (
    <AutoComplete
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      allowClear
      style={{ width: '100%' }}
      filterOption={(input, option) => {
        const needle = input.trim().toLowerCase();
        if (!needle) {
          return true;
        }
        const val = String(option?.value ?? '').toLowerCase();
        const label = String(option?.label ?? '').toLowerCase();
        return val.includes(needle) || label.includes(needle);
      }}
    />
  );
};
