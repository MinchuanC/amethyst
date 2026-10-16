import { GraphView } from '../graph/GraphView';
import { useWorkspace } from '../state/workspace';
import { CommandPalette } from './CommandPalette';
import { ContextMenu } from './ContextMenu';
import { ConfirmDialog, PromptDialog, Toasts } from './Dialogs';
import { ErrorBoundary } from './ErrorBoundary';
import { GraphHud } from './hud/GraphHud';
import { LinkPreview } from './LinkPreview';
import { LinksPanel } from './LinksPanel';
import { NotePanel } from './NotePanel';
import { SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function Shell() {
  const mode = useWorkspace((s) => s.mode);
  const leftOpen = useWorkspace((s) => s.leftOpen);
  const rightOpen = useWorkspace((s) => s.rightOpen);
  const overlay = useWorkspace((s) => s.overlay);

  return (
    <div className={`shell mode-${mode}`}>
      <ErrorBoundary area="The graph" quiet>
        <GraphView />
      </ErrorBoundary>
      <div className="graph-veil" aria-hidden />
      <TitleBar />
      <div
        className={`workspace ${leftOpen ? '' : 'left-closed'} ${rightOpen ? '' : 'right-closed'}`}
        aria-hidden={mode === 'graph'}
        inert={mode === 'graph'}
      >
        <div className="slot slot-left">
          <ErrorBoundary area="The sidebar">
            <Sidebar />
          </ErrorBoundary>
        </div>
        <div className="slot slot-main">
          <ErrorBoundary area="The note">
            <NotePanel />
          </ErrorBoundary>
        </div>
        <div className="slot slot-right">
          <ErrorBoundary area="The links panel">
            <LinksPanel />
          </ErrorBoundary>
        </div>
      </div>
      {mode === 'graph' && (
        <ErrorBoundary area="Graph controls" quiet>
          <GraphHud />
        </ErrorBoundary>
      )}
      {(overlay?.kind === 'palette' || overlay?.kind === 'switcher') && <CommandPalette key={overlay.kind} mode={overlay.kind} />}
      {overlay?.kind === 'prompt' && <PromptDialog overlay={overlay} />}
      {overlay?.kind === 'confirm' && <ConfirmDialog overlay={overlay} />}
      {overlay?.kind === 'settings' && <SettingsDialog />}
      <LinkPreview />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
