import { FolderTree, Hash, Search } from 'lucide-react';
import { useWorkspace, type LeftTab } from '../state/workspace';
import { FileTree } from './FileTree';
import { SearchPane } from './SearchPane';
import { TagsPane } from './TagsPane';

const TABS: { id: LeftTab; label: string; icon: typeof Search }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'tags', label: 'Tags', icon: Hash },
];

export function Sidebar() {
  const tab = useWorkspace((s) => s.leftTab);
  const setTab = useWorkspace((s) => s.setLeftTab);
  return (
    <aside className="panel sidebar" aria-label="Sidebar">
      <div className="sidebar-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="sidebar-tab" onClick={() => setTab(id)}>
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {tab === 'files' && <FileTree />}
        {tab === 'search' && <SearchPane />}
        {tab === 'tags' && <TagsPane />}
      </div>
    </aside>
  );
}
