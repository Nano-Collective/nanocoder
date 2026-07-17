/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./media/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: 'var(--vscode-editor-background)',
          fg: 'var(--vscode-editor-foreground)',
          input: {
            bg: 'var(--vscode-input-background)',
            fg: 'var(--vscode-input-foreground)',
            border: 'var(--vscode-input-border, transparent)',
            focus: 'var(--vscode-focusBorder)'
          },
          button: {
            bg: 'var(--vscode-button-background)',
            fg: 'var(--vscode-button-foreground)',
            hover: 'var(--vscode-button-hoverBackground)',
            secondary: 'var(--vscode-button-secondaryBackground)',
            secondaryHover: 'var(--vscode-button-secondaryHoverBackground)'
          },
          border: 'var(--vscode-panel-border, rgba(128,128,128,0.2))',
          list: {
            hover: 'var(--vscode-list-hoverBackground)',
            error: 'var(--vscode-list-errorForeground, #f44747)'
          },
          error: 'var(--vscode-editorError-foreground, #f48771)',
          dropdown: {
            bg: 'var(--vscode-dropdown-background)',
            fg: 'var(--vscode-dropdown-foreground)',
            border: 'var(--vscode-dropdown-border, transparent)'
          },
          toolbarHover: 'var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15))',
          widget: {
            bg: 'var(--vscode-editorWidget-background)',
            border: 'var(--vscode-widget-border)',
            header: 'var(--vscode-editorWidget-border)'
          }
        }
      },
      fontFamily: {
        vscode: 'var(--vscode-font-family)'
      }
    },
  },
  plugins: [],
}
