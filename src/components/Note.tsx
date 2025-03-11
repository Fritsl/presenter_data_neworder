import React, { useRef, useState } from 'react';
import { Plus, Edit2, MoveVertical, Trash2, Image as ImageIcon, Users } from 'lucide-react';
import { Note as NoteType } from '../types';
import { useNoteStore } from '../store';
import { FullscreenEditor } from './FullscreenEditor';
import { MoveToMenu } from './MoveToMenu';
import { DeleteNoteModal } from './DeleteNoteModal';

const getLevelColor = (level: number = 0): string => {
  const colors = [
    'bg-white hover:bg-gray-50',           // Level 0
    'bg-purple-50 hover:bg-purple-100',    // Level 1
    'bg-blue-50 hover:bg-blue-100',        // Level 2
    'bg-green-50 hover:bg-green-100',      // Level 3
    'bg-amber-50 hover:bg-amber-100',      // Level 4
    'bg-rose-50 hover:bg-rose-100',        // Level 5
  ];
  return colors[Math.min(level, colors.length - 1)];
};

interface NoteProps {
  note: NoteType;
  parentId: string | null;
  level?: number;
}

const linkify = (text: string) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRegex).map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const getLevelStyles = (level: number = 0): string => {
  switch (level) {
    case 0:
      return 'text-xl font-semibold text-gray-900 border-b-2';
    case 1:
      return 'text-lg font-medium text-gray-800';
    case 2:
      return 'text-base font-medium text-gray-700';
    default:
      return 'text-sm text-gray-600';
  }
};

export const Note: React.FC<NoteProps> = ({ note, parentId, level = 0 }) => {
  const { updateNote, toggleEdit, addNote, saveNote, setEditMode, deleteNote, expandedNotes, addImage, removeImage, toggleDiscussion } = useNoteStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSelected, setIsSelected] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  React.useEffect(() => {
    if (note.isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [note.isEditing]);

  // Close selection when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isSelected && !e.defaultPrevented) {
        setIsSelected(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isSelected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      toggleEdit(note.id);
    }
  };

  return (
    <div
      className="group relative"
      id={note.id}
    >
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsSelected(true);
        }}
        className={`flex items-start gap-2 p-3 rounded-lg shadow-sm hover:shadow-md transition-all ${getLevelColor(level)} ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      >
        <div className="w-full">
          <div className="flex flex-col gap-2">
            {note.isEditing ? (
              <FullscreenEditor
                content={note.unsavedContent ?? note.content}
                sequenceNumber={note.sequence_number}
                isNew={!note.content}
                note={note}
                onChange={(content) => updateNote(note.id, content)}
                onClose={() => {
                  setEditMode(false);
                  saveNote(note.id);
                  toggleEdit(note.id);
                }}
              />
            ) : (
              <div className="flex-1">
                <div className="flex flex-col gap-2">
                  <div className={`whitespace-pre-wrap break-words ${getLevelStyles(level)} ${level === 0 ? 'border-gray-200' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span>{linkify(note.content || 'Empty note...')}</span>
                      {note.images && note.images.length > 0 && (
                        <span className="text-gray-400">
                          <ImageIcon className="w-4 h-4" />
                        </span>
                      )}
                      {note.is_discussion && (
                        <Users className="w-4 h-4 text-blue-500" />
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 ${isSelected || note.isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditMode(true);
                          toggleEdit(note.id);
                          setIsSelected(false);
                        }}
                        className="p-1.5 rounded hover:bg-gray-200 touch-manipulation transition-colors"
                      >
                        <Edit2 className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMoveMenuOpen(true);
                          setIsSelected(false);
                        }}
                        className="p-1.5 rounded hover:bg-gray-200 touch-manipulation transition-colors"
                      >
                        <MoveVertical className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addNote(note.id);
                          setIsSelected(false);
                        }}
                        className="p-1.5 rounded hover:bg-gray-200 touch-manipulation transition-colors"
                      >
                        <Plus className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteModal(true);
                          setIsSelected(false);
                        }}
                        className="p-1.5 rounded hover:bg-gray-200 touch-manipulation transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {note.children.length > 0 && expandedNotes.has(note.id) && (
            <div className="pl-4 mt-3 space-y-3 border-l-2 border-gray-200">
              {note.children.map((child) => (
                <Note 
                  key={child.id} 
                  note={child} 
                  parentId={note.id} 
                  level={Math.min(level + 1, 4)} 
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {isMoveMenuOpen && (
        <MoveToMenu
          noteId={note.id}
          onClose={() => setIsMoveMenuOpen(false)}
        />
      )}
      {showDeleteModal && (
        <DeleteNoteModal
          noteContent={note.content}
          note={note}
          onConfirm={async () => {
            console.log('Delete confirmation clicked:', {
              noteId: note.id,
              noteContent: note.content,
              childCount: note.children.length,
              parentId,
              level
            });
            await deleteNote(note.id);
            console.log('Delete operation completed');
            setShowDeleteModal(false);
          }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
};