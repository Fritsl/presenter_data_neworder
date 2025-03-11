import { StateCreator } from 'zustand';
import { Note, NoteStore } from '../types';
import { supabase } from '../lib/supabase';
import { findNoteById } from '../lib/utils';

const generateId = () => crypto.randomUUID();

const removeNoteById = (notes: Note[], id: string): Note[] => {
  return notes.filter(note => {
    if (note.id === id) return false;
    note.children = removeNoteById(note.children, id);
    return true;
  });
};

export const createNoteSlice: StateCreator<NoteStore> = (set, get) => ({
  notes: [],
  undoStack: [],
  canUndo: false,
  isEditMode: false,
  expandedNotes: new Set<string>(),
  currentLevel: 0,
  canExpandMore: false,
  canCollapseMore: false,

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length > 0) {
      const command = undoStack[undoStack.length - 1];
      command.undo();
      set(state => ({
        undoStack: state.undoStack.slice(0, -1),
        canUndo: state.undoStack.length > 1
      }));
    }
  },

  updateNote: async (id: string, content: string) => {
    set(state => {
      const updateNoteContent = (notes: Note[]): Note[] => {
        const oldNote = findNoteById(state.notes, id);
        const oldContent = oldNote?.content;
        return notes.map(note => {
          if (note.id === id) {
            state.undoStack.push({
              execute: () => get().updateNote(id, content),
              undo: () => {
                if (oldContent !== undefined) {
                  get().updateNote(id, oldContent);
                  if (oldNote) get().toggleDiscussion(id, oldNote.is_discussion);
                  get().saveNote(id);
                }
              },
              description: `Update note content`
            });
            return { ...note, unsavedContent: content };
          }
          return { ...note, children: updateNoteContent(note.children) };
        });
      };
      const newNotes = updateNoteContent(state.notes);
      return { 
        notes: newNotes,
        canUndo: true
      };
    });
  },

  deleteNote: async (id: string) => {
    try {
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      set(state => ({
        notes: removeNoteById(state.notes, id)
      }));
    } catch (error) {
      console.error('Error deleting note:', error);
      throw error;
    }
  },

  addNote: async (parentId: string | null) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (!projectId) {
      console.error('No project ID found');
      return;
    }

    const { data: currentProject } = await supabase
      .from('settings')
      .select()
      .eq('id', projectId)
      .maybeSingle();

    if (!currentProject) {
      console.error('No project found');
      return;
    }

    const { data: lastNote } = await supabase
      .from('notes')
      .select('position')
      .eq('project_id', currentProject.id)
      .is('parent_id', parentId || null)
      .order('position', { ascending: false })
      .limit(1);

    const position = (lastNote?.[0]?.position ?? -1) + 1;

    const newNote: Note = {
      id: generateId(),
      content: '',
      children: [],
      isEditing: true,
      unsavedContent: '',
      position,
      user_id: userData.user.id,
      is_discussion: false,
      project_id: currentProject.id,
      images: []
    };

    const { error } = await supabase
      .from('notes')
      .insert({
        id: newNote.id,
        content: newNote.content,
        parent_id: parentId,
        user_id: userData.user.id,
        is_discussion: false,
        project_id: currentProject.id,
        position
      });

    if (error) {
      console.error('Error adding note:', error);
      return;
    }

    set(state => {
      if (!parentId) {
        return { notes: [...state.notes, newNote] };
      }

      const updateChildren = (notes: Note[]): Note[] => {
        return notes.map(note => {
          if (note.id === parentId) {
            const newChildren = [...note.children, newNote];
            return { ...note, children: newChildren };
          }
          return { ...note, children: updateChildren(note.children) };
        });
      };

      return { notes: updateChildren(state.notes) };
    });
  },

  saveNote: async (id: string) => set(state => {
    const note = findNoteById(state.notes, id);
    if (!note?.unsavedContent && note?.content === '') {
      supabase
        .from('notes')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) console.error('Error deleting empty note:', error);
        });
      return { notes: removeNoteById(state.notes, id) };
    }

    if (note && note.unsavedContent !== undefined) {
      supabase
        .from('notes')
        .update({ content: note.unsavedContent })
        .eq('id', id)
        .then(({ error }) => {
          if (error) console.error('Error saving note:', error);
        });

      const updateContent = (notes: Note[]): Note[] => {
        return notes.map(n => {
          if (n.id === id) {
            return { ...n, content: note.unsavedContent, unsavedContent: undefined };
          }
          return { ...n, children: updateContent(n.children) };
        });
      };
      return { notes: updateContent(state.notes) };
    }
    return state;
  }),

  toggleEdit: (id: string) => set(state => {
    const toggleNoteEdit = (notes: Note[]): Note[] => {
      return notes.map(note => {
        if (note.id === id) {
          const newIsEditing = !note.isEditing;
          set(state => ({ ...state, isEditMode: newIsEditing }));
          return { ...note, isEditing: newIsEditing };
        }
        return { ...note, children: toggleNoteEdit(note.children) };
      });
    };

    return { notes: toggleNoteEdit(state.notes) };
  })
});