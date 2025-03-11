import { StateCreator } from 'zustand';
import { Store } from '../types';
import { supabase } from '../../lib/supabase';
import { findNoteById, removeNoteById } from '../../lib/utils';

export const createNoteSlice: StateCreator<Store> = (set, get) => ({
  notes: [],
  undoStack: [],
  canUndo: false,
  isEditMode: false,
  expandedNotes: new Set<string>(),
  currentLevel: 0,
  canExpandMore: false,
  canCollapseMore: false,

  loadNotes: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    try {
      const { data: existingSettings, error: settingsError } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', userData.user.id)
        .single();

      if (settingsError) throw settingsError;

      const currentProject = existingSettings?.projects?.find(
        (p: any) => p.id === existingSettings.current_project_id
      );

      if (currentProject) {
        set({
          title: currentProject.title,
          projects: existingSettings
        });
        
        // Get sequences first for ordering
        const { data: sequences } = await supabase
          .from('note_sequences')
          .select('note_id, sequence')
          .eq('project_id', currentProject.id)
          .order('sequence');

        const orderMap = new Map(sequences?.map(s => [s.note_id, s.sequence]) || []);

        // Then get notes with their images
        const { data: notes, error } = await supabase
          .from('notes')
          .select(`
            *,
            images:note_images(*)
          `)
          .eq('user_id', userData.user.id)
          .eq('project_id', currentProject.id);

        if (error) {
          console.error('Error loading notes:', error);
          return;
        }

        // Sort notes based on sequence
        const sortedNotes = notes?.sort((a, b) => {
          const seqA = orderMap.get(a.id) || 0;
          const seqB = orderMap.get(b.id) || 0;
          return seqA - seqB;
        });

        const noteMap = new Map(sortedNotes?.map(note => ({
          ...note,
          images: note.images?.sort((a, b) => a.position - b.position) || [],
          children: [],
          isEditing: false,
          unsavedContent: undefined
        })).map(note => [note.id, note]));

        sortedNotes?.forEach(note => {
          if (note.parent_id) {
            const parent = noteMap.get(note.parent_id);
            if (parent) {
              parent.children.push(noteMap.get(note.id));
            }
          }
        });

        const rootNotes = notes
          ?.filter(note => !note.parent_id)
          .map(note => noteMap.get(note.id));

        set({ notes: rootNotes || [] });
          } catch (error) {
      console.error('Error in loadNotes:', error);
    }
      },
  }

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
      const { error } = await supabase.rpc('delete_note_safely', {
        note_id: id
      });

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
    if (!projectId) return;

    // Get the next sequence number
    const { data: nextSeq } = await supabase.rpc('get_next_sequence', {
      p_project_id: projectId,
      p_parent_id: parentId
    });

    if (!nextSeq) {
      console.error('Failed to get next sequence number');
      return;
    }

    // Get the next sequence number
    const { data: nextSeq } = await supabase.rpc('get_next_sequence', {
      p_project_id: projectId,
      p_parent_id: parentId
    });

    if (!nextSeq) {
      console.error('Failed to get next sequence number');
      return;
    }

    const newNote: Note = {
      id: crypto.randomUUID(),
      content: '',
      children: [],
      isEditing: true,
      unsavedContent: '', 
      is_discussion: false,
      project_id: projectId,
      images: []
    };

    // First insert the note
    // First insert the note
    const { error: noteError } = await supabase
      .from('notes')
      .insert({
        id: newNote.id,
        content: newNote.content,
        parent_id: parentId,
        user_id: userData.user.id,
        project_id: projectId,
        is_discussion: false
      });

    // Insert into note_sequences table
    const { error: seqError } = await supabase
      .from('note_sequences')
      .insert({
        project_id: projectId,
        parent_id: parentId,
        note_id: newNote.id,
        sequence: nextSeq || 1
      });

    // Insert into note_sequences table
    const { error: seqError } = await supabase
      .from('note_sequences')
      .insert({
        project_id: projectId,
        parent_id: parentId,
        note_id: newNote.id,
        sequence: nextSeq
      });

    if (noteError || seqError) {
      console.error('Error adding note:', { noteError, seqError });
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
  }),

  setCurrentLevel: (level: number) => set(state => {
    const calculateMaxDepth = (notes: Note[], depth = 0): number => {
      let maxDepth = depth;
      notes.forEach(note => {
        if (note.children.length > 0) {
          maxDepth = Math.max(maxDepth, calculateMaxDepth(note.children, depth + 1));
        }
      });
      return maxDepth;
    };

    const treeDepth = calculateMaxDepth(state.notes);
    const newLevel = Math.max(0, Math.min(level, treeDepth));

    const newExpandedNotes = new Set(state.expandedNotes);
    const updateExpanded = (notes: Note[], currentDepth = 0) => {
      notes.forEach(note => {
        if (note.children.length > 0) {
          if (currentDepth < newLevel) {
            newExpandedNotes.add(note.id);
          } else {
            newExpandedNotes.delete(note.id);
          }
          updateExpanded(note.children, currentDepth + 1);
        }
      });
    };

    updateExpanded(state.notes);

    return {
      expandedNotes: newExpandedNotes,
      currentLevel: newLevel,
      canExpandMore: newLevel < treeDepth,
      canCollapseMore: newLevel > 0
    };
  }),

  expandOneLevel: () => {
    const state = get();
    return state.setCurrentLevel(state.currentLevel + 1);
  },

  collapseOneLevel: () => {
    const state = get();
    return state.setCurrentLevel(state.currentLevel - 1);
  },

  setEditMode: (isEditing: boolean) => set({ isEditMode }),

  addImage: async (noteId: string, url: string) => {
    try {
      const { data, error } = await supabase
        .from('note_images')
        .insert([{
          note_id: noteId,
          url,
          position: 0
        }])
        .select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Failed to create image record');

      set(state => {
        const newNotes = [...state.notes];
        const noteIndex = newNotes.findIndex(note => note.id === noteId);
        if (noteIndex !== -1) {
          if (!newNotes[noteIndex].images) {
            newNotes[noteIndex].images = [];
          }
          newNotes[noteIndex].images?.push(data[0]);
        }
        return { notes: newNotes };
      });
    } catch (error) {
      console.error('Error in addImage:', error);
      throw error;
    }
  },

  removeImage: async (noteId: string, imageId: string) => {
    try {
      const { error } = await supabase
        .from('note_images')
        .delete()
        .eq('id', imageId);

      if (error) throw error;

      set(state => {
        const newNotes = [...state.notes];
        const noteIndex = newNotes.findIndex(note => note.id === noteId);
        if (noteIndex !== -1 && newNotes[noteIndex].images) {
          newNotes[noteIndex].images = newNotes[noteIndex].images?.filter(
            img => img.id !== imageId
          );
        }
        return { notes: newNotes };
      });
    } catch (error) {
      console.error('Error removing image:', error);
      throw error;
    }
  },

  toggleDiscussion: async (id: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('notes')
        .update({ is_discussion: value })
        .eq('id', id);

      if (error) throw error;

      set(state => {
        const updateDiscussionFlag = (notes: Note[]): Note[] => {
          return notes.map(note => {
            if (note.id === id) {
              state.undoStack.push({
                execute: () => get().toggleDiscussion(id, value),
                undo: () => get().toggleDiscussion(id, !value),
                description: `Toggle discussion flag`
              });
              return { ...note, is_discussion: value };
            }
            return { ...note, children: updateDiscussionFlag(note.children) };
          });
        };
        return { notes: updateDiscussionFlag(state.notes), canUndo: true };
      });
    } catch (error) {
      console.error('Error toggling discussion flag:', error);
    }
  },

  moveNote: async (id: string, parentId: string | null, index: number) => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project');
      if (!projectId) return;

      const noteToMove = findNoteById(get().notes, id);
      if (!noteToMove) return;

      // Update parent in notes table
      const { error: noteError } = await supabase
        .from('notes')
        .update({ parent_id: parentId })
        .eq('id', id);

      if (noteError) throw noteError;

      // Update sequence
      const { error: seqError } = await supabase.rpc('move_note', {
        p_note_id: id, 
        p_new_parent_id: parentId, 
        p_new_position: index
      });

      if (seqError) throw seqError;

      set(state => {
        const notesWithoutMoved = removeNoteById(state.notes, id);

        if (!parentId) {
          const newNotes = [...notesWithoutMoved];
          newNotes.splice(index, 0, noteToMove);
          return { notes: newNotes };
        }

        const insertIntoParent = (notes: Note[]): Note[] => {
          return notes.map(note => {
            if (note.id === parentId) {
              const newChildren = [...note.children];
              newChildren.splice(index, 0, noteToMove);
              return { ...note, children: newChildren };
            }
            return { ...note, children: insertIntoParent(note.children) };
          });
        };

        return { notes: insertIntoParent(notesWithoutMoved) };
      });
    } catch (error) {
      console.error('Error moving note:', error);
      throw error;
    }
  },

  printNotes: () => {
    const { notes, expandedNotes } = get();
    return formatNotesAsText(notes, expandedNotes);
  }
});