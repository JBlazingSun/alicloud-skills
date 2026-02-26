'use client';

import Editor from '@monaco-editor/react';

type TomlCodeEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onSave?: () => void;
};

export function TomlCodeEditor({ value, onChange, onSave }: TomlCodeEditorProps) {
  return (
    <Editor
      height="260px"
      defaultLanguage="toml"
      value={value}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 2,
        automaticLayout: true,
      }}
      onMount={(editor, monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSave?.();
        });
      }}
      onChange={(next) => onChange(next ?? '')}
    />
  );
}
