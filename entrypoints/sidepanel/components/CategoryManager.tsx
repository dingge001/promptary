import { useMemo, useState } from 'react';
import { categoryLabel, t } from '@/lib/i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  buildCategoryTree,
  countItemsByCategory,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  type CategoryNode,
} from '@/lib/db/repo';
import { IconCheck, IconClose, IconPencil, IconPlus, IconTrash } from './icons';
import { Button } from './ui';

const inputCls =
  'rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-accent dark:border-neutral-700';

interface Props {
  onClose: () => void;
}

export default function CategoryManager({ onClose }: Props) {
  const categories = useLiveQuery(() => listCategories(), []);
  const counts = useLiveQuery(() => countItemsByCategory(), []);

  const tree = useMemo(
    () => (categories ? buildCategoryTree(categories, counts) : []),
    [categories, counts],
  );

  const [newName, setNewName] = useState('');

  const addTopLevel = async () => {
    const name = newName.trim();
    if (!name) return;
    await createCategory(name);
    setNewName('');
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-medium">{t('category.title')}</span>
        <Button size="sm" square onClick={onClose} title={t('common.done')} icon={<IconCheck />} />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {tree.length === 0 ? (
          <p className="px-1 py-3 text-[11px] text-neutral-400">{t('category.empty')}</p>
        ) : (
          tree.map((node) => <CategoryRow key={node.id} node={node} depth={0} />)
        )}
      </div>

      <div className="flex gap-1.5 border-t border-neutral-200 p-2 dark:border-neutral-800">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTopLevel();
          }}
          placeholder={t('category.newTop')}
          className={`${inputCls} flex-1`}
        />
        <Button
          variant="primary"
          size="sm"
          square
          onClick={addTopLevel}
          title={t('category.addTop')}
          icon={<IconPlus />}
        />
      </div>
    </div>
  );
}

function CategoryRow({ node, depth }: { node: CategoryNode; depth: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');

  const saveRename = async () => {
    const name = draft.trim();
    if (name && name !== node.name) await renameCategory(node.id, name);
    setEditing(false);
  };

  const addChild = async () => {
    const name = childName.trim();
    if (!name) return;
    await createCategory(name, node.id);
    setChildName('');
    setAddingChild(false);
  };

  const remove = async () => {
    // 说清楚「收藏不会被删」,否则用户不敢点
    const detail =
      node.total > 0
        ? t('category.deleteWithItems', { name: node.name, count: node.total })
        : t('category.deleteEmpty', { name: node.name });
    if (!confirm(detail)) return;
    await deleteCategory(node.id);
  };

  return (
    <>
      <div
        className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {editing ? (
          <>
            <input
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              className={`${inputCls} flex-1`}
            />
            <Button size="sm" square onClick={saveRename} title={t('common.save')} icon={<IconCheck />} />
            <Button
              size="sm"
              square
              onClick={() => setEditing(false)}
              title={t('common.cancel')}
              icon={<IconClose />}
            />
          </>
        ) : (
          <>
            <span className="flex-1 truncate text-[11px]">{categoryLabel(node.name)}</span>
            <span className="text-[10px] text-neutral-400">{node.total}</span>
            <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                size="xs"
                square
                variant="ghost"
                onClick={() => setEditing(true)}
                title={t('category.rename')}
                icon={<IconPencil className="h-3 w-3" />}
              />
              <Button
                size="xs"
                square
                variant="ghost"
                onClick={() => setAddingChild((v) => !v)}
                title={t('category.addChild')}
                icon={<IconPlus className="h-3 w-3" />}
              />
              <Button
                size="xs"
                square
                variant="ghost"
                onClick={remove}
                title={t('common.delete')}
                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                icon={<IconTrash className="h-3 w-3" />}
              />
            </span>
          </>
        )}
      </div>

      {addingChild && (
        <div className="flex gap-1 px-1 py-1" style={{ paddingLeft: (depth + 1) * 14 + 4 }}>
          <input
            value={childName}
            autoFocus
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addChild();
              if (e.key === 'Escape') setAddingChild(false);
            }}
            placeholder={t('category.childPlaceholder', { name: node.name })}
            className={`${inputCls} flex-1`}
          />
          <Button
            size="xs"
            square
            onClick={addChild}
            title={t('category.addChild')}
            icon={<IconCheck className="h-3 w-3" />}
          />
        </div>
      )}

      {node.children.map((child) => (
        <CategoryRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
