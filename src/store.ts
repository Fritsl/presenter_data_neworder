import { create } from 'zustand';
import { Note, NoteStore } from './types';
import { supabase } from './lib/supabase';
import { findNoteById, formatNotesAsText, getUniqueTitle, removeNoteById } from './lib/utils';

const generateId = () => crypto.randomUUID();

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  title: 'New Project',
  undoStack: [],
  canUndo: false,
  isEditMode: false,
  expandedNotes: new Set<string>(),
  currentLevel: 0,
  canExpandMore: false,
  canCollapseMore: false,
  projects: [],

  updateTitle: async (title: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // Get current project ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (!projectId) return;

    try {
      // Validate title
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error('Title cannot be empty');
      }
      if (trimmedTitle.length > 50) {
        throw new Error('Title cannot be longer than 50 characters');
      }
      if (!/^[a-zA-Z0-9\s\-_.,!?()]+$/.test(trimmedTitle)) {
        throw new Error('Title can only contain letters, numbers, spaces, and basic punctuation');
      }
      
      // Check if title already exists for another project
      const { data: existingProject } = await supabase
        .from('settings')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('title', trimmedTitle)
        .neq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

      if (existingProject) {
        throw new Error('A project with this title already exists');
      }

      // Update project title
      const { error } = await supabase
        .from('settings')
        .update({
          title: trimmedTitle,
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId)
        .eq('user_id', userData.user.id);

      if (error) throw error;

      // Update local state
      set({ title: trimmedTitle });

      // Update projects list with new title
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? {
            ...p,
            title: trimmedTitle,
            updated_at: new Date().toISOString()
          } : p
        )
      }));
    } catch (error) {
      console.error('Error updating title:', error);
      throw error;
    }
  },

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

  deleteProject: async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const urlParams = new URLSearchParams(window.location.search);
    const currentProjectId = urlParams.get('project');

    try {
      // Soft delete the project
      const { error: projectError } = await supabase.rpc('soft_delete_project', {
        project_id: id
      });

      if (projectError) throw projectError;

      // Switch to another project if we deleted the current one
      if (currentProjectId === id) {
        const { data: remainingProjects } = await supabase
          .from('settings')
          .select()
          .is('deleted_at', null)
          .eq('user_id', userData.user.id)
          .order('last_modified_at', { ascending: false, nullsLast: true })
          .limit(1);

        if (remainingProjects && remainingProjects.length > 0) {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('project', remainingProjects[0].id);
          window.history.replaceState({}, '', newUrl.toString());
          await get().switchProject(remainingProjects[0].id);
        } else {
          // If no projects remain, create a new one
          const { data: newProject } = await supabase
            .from('settings')
            .insert({
              user_id: userData.user.id,
              title: 'New Project'
            })
            .select()
            .single();

          if (newProject) {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('project', newProject.id);
            window.history.replaceState({}, '', newUrl.toString());
            await get().switchProject(newProject.id);
          }
        }
      }

      // Refresh the projects list
      const { data: updatedProjects } = await supabase
        .from('settings')
        .select('*')
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .order('created_at');

      // Update local state with fresh data
      set({ projects: updatedProjects || [] });

    } catch (error) {
      console.error('Error deleting project:', error instanceof Error ? error.message : error);
      throw error;
    }
  },

  moveNote: async (id: string, parentId: string | null, index: number) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      // Get current project ID from URL
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project');
      if (!projectId) return;

      // Find the note to move and its current theme
      const noteToMove = findNoteById(get().notes, id);
      if (!noteToMove) return;
      
      // Get all notes at the target level to calculate new position
      let query = supabase
        .from('notes')
        .select('id, position')
        .eq('project_id', projectId);

      // Handle null and non-null parent_id cases separately
      if (parentId === null) {
        query = query.is('parent_id', null);
      } else {
        query = query.eq('parent_id', parentId);
      }

      const { data: siblingNotes } = await query.order('position');

      // Calculate new position
      let newPosition: number;
      if (!siblingNotes || siblingNotes.length === 0) {
        newPosition = 0;
      } else if (index === 0) {
        newPosition = siblingNotes[0].position - 1;
      } else if (index >= siblingNotes.length) {
        newPosition = siblingNotes[siblingNotes.length - 1].position + 1;
      } else {
        newPosition = (siblingNotes[index - 1].position + siblingNotes[index].position) / 2;
      }

      // Update note in database with new position, parent_id, and theme
      const { error } = await supabase
        .from('notes')
        .update({
          parent_id: parentId,
          position: newPosition
        })
        .eq('id', id);

      if (error) throw error;

      // Update local state
      set(state => {
        // First remove the note from its current location
        const noteToMove = findNoteById(state.notes, id);
        if (!noteToMove) return state;

        const notesWithoutMoved = removeNoteById(state.notes, id);

        // Then insert it at the new location
        if (!parentId) {
          // Insert at root level
          const newNotes = [...notesWithoutMoved];
          newNotes.splice(index, 0, noteToMove);
          return { notes: newNotes };
        }

        // Insert as child of parent note
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

  deleteNote: async (id: string) => {
    try {
      console.log('Starting deleteNote operation:', { id });
      
      // Log the note being deleted
      const noteToDelete = findNoteById(get().notes, id);
      console.log('Note to delete:', {
        id: noteToDelete?.id,
        content: noteToDelete?.content,
        childCount: noteToDelete?.children.length,
        projectId: noteToDelete?.project_id
      });

      // Delete the note directly without handling the children separately
      // The database will handle cascading deletes via constraints
      console.log('Sending delete request to Supabase');
      
      // Use the RPC endpoint to handle deletion with controlled recursion
      const { error } = await supabase.rpc('delete_note_safely', {
        note_id: id
      });

      if (error) {
        console.error('Supabase delete error:', {
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      
      console.log('Supabase delete successful');

      // Update local state - simple approach to avoid recursion issues
      console.log('Updating local state');
      set(state => {
        // Use the simplified removeNoteById that doesn't have excessive logging
        const newNotes = removeNoteById(state.notes, id);
        console.log('Local state updated, notes count:', newNotes.length);
        return { notes: newNotes };
      });
      
      console.log('Delete operation completed successfully');
    } catch (error) {
      console.error('Error in deleteNote:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  },

  updateNote: async (id: string, content: string) => {
    set(state => {
      const updateNoteContent = (notes: Note[]): Note[] => {
        const oldNote = findNoteById(state.notes, id);
        const oldContent = oldNote?.content;
        return notes.map(note => {
          if (note.id === id) {
            // Add to undo stack
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
              // Add to undo stack
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

  addNote: async (parentId: string | null) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // Get current project ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (!projectId) {
      console.error('No project ID found');
      
      // If no project ID in URL, check if we have projects in the state
      const { projects } = get();
      if (projects && projects.length > 0) {
        const firstProject = projects[0];
        console.log('Using first available project:', firstProject.id);
        
        // Update URL with the first project ID
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', firstProject.id);
        window.history.replaceState({}, '', newUrl.toString());
        
        // Continue with this project ID
        return get().addNote(parentId);
      }
      
      return;
    }

    // Get current project settings
    const { data: currentProject } = await supabase
      .from('settings')
      .select()
      .eq('id', projectId)
      .maybeSingle();

    if (!currentProject) {
      console.error('No project found');
      return;
    }

    // Get the highest position for notes in the current context
    const { data: lastNote } = await supabase
      .from('notes')
      .select('position')
      .eq('project_id', currentProject.id)
      .eq('parent_id', parentId === null ? null : parentId)
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

    const { data, error } = await supabase
      .from('notes')
      .insert({
        id: newNote.id,
        content: newNote.content,
        parent_id: parentId,
        user_id: userData.user.id,
        is_discussion: false,
        project_id: currentProject.id,
        position
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding note:', error);
      return;
    }

    // Update local state with the new note
    set(state => {
      if (!parentId) {
        return { notes: [...state.notes, newNote] };
      }

      // Add note to parent's children
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

  setCurrentLevel: (level: number) => set(state => {
    // Calculate maximum depth
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

    // Update expanded notes to match the new level
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

  setEditMode: (isEditing: boolean) => set({ isEditMode: isEditing }),

  addImage: async (noteId: string, url: string) => {
    try {
      console.log('Starting addImage process:', { noteId, urlLength: url.length });
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        console.error('No authenticated user found');
        throw new Error('Authentication required');
      }

      // Extract storage path from URL if it's a Supabase URL
      let storagePath = null;
      if (url.includes('note-images')) {
        try {
          console.log('Attempting to parse storage path from URL');
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/');
          const storageIndex = pathParts.findIndex(part => part === 'object');
          if (storageIndex !== -1 && pathParts.length > storageIndex + 2) {
            // Extract the path after 'object/public/'
            storagePath = pathParts.slice(storageIndex + 2).join('/');
            console.log('Storage path extracted:', storagePath);
          }
        } catch (e) {
          console.error('Failed to parse storage path from URL:', e);
        }
      }

      console.log('Inserting image record into database');
      const { data, error } = await supabase
        .from('note_images')
        .insert([
          {
            note_id: noteId,
            url,
            storage_path: storagePath,
            position: 0,
          },
        ])
        .select();

      if (error) {
        console.error('Database error while inserting image:', error);
        throw error;
      }
      
      if (!data || data.length === 0) {
        console.error('No data returned from image insert');
        throw new Error('Failed to create image record');
      }
      
      console.log('Image record created successfully:', data[0]);

      set((state) => {
        console.log('Updating local state with new image');
        const newNotes = [...state.notes];
        const noteIndex = newNotes.findIndex((note) => note.id === noteId);
        if (noteIndex !== -1) {
          if (!newNotes[noteIndex].images) {
            newNotes[noteIndex].images = [];
          }
          newNotes[noteIndex].images?.push(data[0]);
          console.log('Local state updated successfully');
        } else {
          console.warn('Note not found in local state:', noteId);
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
      console.log('Starting removeImage process:', { noteId, imageId });

      // First get the image to check if we need to delete from storage
      console.log('Fetching image data from database');
      const { data: imageData, error: fetchError } = await supabase
        .from('note_images')
        .select()
        .eq('id', imageId)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching image:', fetchError);
        return;
      }

      console.log('Image data retrieved:', imageData);

      // If the image has a storage path, delete it from storage
      if (imageData?.storage_path) {
        console.log('Attempting to delete image from storage:', imageData.storage_path);
        const { error: storageError } = await supabase.storage
          .from('note-images')
          .remove([imageData.storage_path]);

        if (storageError) {
          console.error('Error removing image from storage:', storageError);
        } else {
          console.log('Image successfully deleted from storage');
        }
      }

      // Delete the database record
      console.log('Deleting image record from database');
      const { error } = await supabase
        .from('note_images')
        .delete()
        .eq('id', imageId);

      if (error) {
        console.error('Error deleting image record:', error);
        throw error;
      }
      console.log('Image record successfully deleted from database');

      // Update the local state
      set((state) => {
        console.log('Updating local state');
        const newNotes = [...state.notes];
        const noteIndex = newNotes.findIndex((note) => note.id === noteId);
        console.log('Found note index:', noteIndex);
        if (noteIndex !== -1 && newNotes[noteIndex].images) {
          const oldImageCount = newNotes[noteIndex].images?.length || 0;
          newNotes[noteIndex].images = newNotes[noteIndex].images?.filter(
            (img) => img.id !== imageId
          );
          const newImageCount = newNotes[noteIndex].images?.length || 0;
          console.log('Images filtered:', {
            oldCount: oldImageCount,
            newCount: newImageCount,
            removed: oldImageCount - newImageCount
          });
        } else {
          console.warn('Note not found or has no images:', {
            noteFound: noteIndex !== -1,
            hasImages: noteIndex !== -1 && !!newNotes[noteIndex].images
          });
        }
        console.log('Local state update complete');
        return { notes: newNotes };
      });
    } catch (error) {
      console.error('Error removing image:', error);
      console.error('Full error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        error
      });
    }
  },

  loadProjects: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: projects, error } = await supabase
      .from('settings')
      .select('*')
      .is('deleted_at', null)
      .eq('user_id', userData.user.id)
      .order('last_modified_at', { ascending: false, nullsLast: true });

    if (error) {
      console.error('Error loading projects:', error);
      return;
    }

    set({ projects: projects || [] });
  },

  loadNotes: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    try {
      // Get all projects for the user
      const { data: existingSettings, error: settingsError } = await supabase
        .from('settings')
        .select()
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .order('last_modified_at', { ascending: false, nullsLast: true });

      if (settingsError) {
        console.error('Error loading settings:', settingsError);
        return;
      }

      if (existingSettings && existingSettings.length > 0) {
        // Get current project ID from URL or use the first one
        const urlParams = new URLSearchParams(window.location.search);
        const projectId = urlParams.get('project');

        let currentProject = projectId 
          ? existingSettings.find(p => p.id === projectId) 
          : existingSettings[0];

        // If project ID from URL is invalid, use first project
        if (!currentProject) {
          currentProject = existingSettings[0];
        }

        // Update URL with project ID
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', currentProject.id);
        window.history.replaceState({}, '', newUrl.toString());

        set({ 
          title: currentProject.title,
          projects: existingSettings
        });

        // Load notes and their images for the current project
        const { data: notes, error } = await supabase
          .from('notes')
          .select(`
            *,
            images:note_images(*)
          `)
          .eq('user_id', userData.user.id)
          .eq('project_id', currentProject.id)
          .order('position');

        if (error) {
          console.error('Error loading notes:', error);
          return;
        }

        // Convert flat structure to tree
        const noteMap = new Map(notes?.map(note => ({
          ...note,
          images: note.images?.sort((a, b) => a.position - b.position) || [],
          children: []
        })).map(note => [note.id, note]) ?? []);
        const rootNotes: Note[] = [];

        notes?.forEach(note => {
          const noteWithChildren = noteMap.get(note.id)!;
          if (note.parent_id) {
            const parent = noteMap.get(note.parent_id);
            if (parent) {
              parent.children.push(noteWithChildren);
            }
          } else {
            rootNotes.push(noteWithChildren);
          }
        });

        set({ notes: rootNotes });
      } else {
        // Create first project for new users
        const { data: newSettings } = await supabase
          .from('settings')
          .insert({
            user_id: userData.user.id,
            title: 'New Project'
          })
          .select()
          .single();

        if (!newSettings) {
          console.error('Failed to create initial project');
          return;
        }

        // Initialize with empty state
        set({ 
          title: newSettings.title,
          projects: [newSettings],
          notes: []
        });

        // Set initial project ID in URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', newSettings.id);
        window.history.replaceState({}, '', newUrl.toString());
      }
    } catch (error) {
      console.error('Error in loadNotes:', error);
    }
  },

  switchProject: async (projectId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    // Clear notes while loading
    set({ notes: [] }); // Clear notes while loading

    try {
      // Get project details
      const { data: project, error: projectError } = await supabase
        .from('settings')
        .select('*')
        .is('deleted_at', null)
        .eq('user_id', userData.user.id)
        .eq('id', projectId)
        .single();

      if (projectError || !project) {
        throw new Error('Project not found');
      }

      // Update URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('project', project.id);
      window.history.replaceState({}, '', newUrl.toString());

      // Update local state
      set({ title: project.title });

      // Load notes and their images for the current project
      const { data: notes, error } = await supabase
        .from('notes')
        .select(`
          *,
          images:note_images(*)
        `)
        .eq('user_id', userData.user.id)
        .eq('project_id', projectId)
        .order('position');

      if (error) {
        throw new Error('Failed to load notes');
      }

      // Convert flat structure to tree
      const noteMap = new Map(notes?.map(note => ({
        ...note,
        images: note.images?.sort((a, b) => a.position - b.position) || [],
        children: []
      })).map(note => [note.id, note]) ?? []);
      const rootNotes: Note[] = [];

      notes?.forEach(note => {
        const noteWithChildren = noteMap.get(note.id);
        if (noteWithChildren) {
          if (note.parent_id && noteMap.has(note.parent_id)) {
            const parent = noteMap.get(note.parent_id);
            parent?.children.push(noteWithChildren);
          } else {
            rootNotes.push(noteWithChildren);
          }
        }
      });

      set({ notes: rootNotes });
    } catch (error) {
      console.error('Error switching project:', error);
      
      // Handle invalid project ID
      const { data: firstProject } = await supabase
        .from('settings')
        .select()
        .eq('user_id', userData.user.id)
        .order('created_at')
        .limit(1)
        .single();

      if (firstProject) {
        // Switch to first available project
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', firstProject.id); 
        window.history.replaceState({}, '', newUrl.toString());
        
        // Retry with first project
        const { data: notes, error } = await supabase
          .from('notes')
          .select(`
            *,
            images:note_images(*)
          `)
          .eq('user_id', userData.user.id)
          .eq('project_id', firstProject.id)
          .order('position');

        if (error) {
          throw new Error('Failed to load notes');
        }

        // Convert flat structure to tree
        const noteMap = new Map(notes?.map(note => ({
          ...note,
          images: note.images?.sort((a, b) => a.position - b.position) || [],
          children: []
        })).map(note => [note.id, note]) ?? []);
        const rootNotes: Note[] = [];

        notes?.forEach(note => {
          const noteWithChildren = noteMap.get(note.id);
          if (noteWithChildren) {
            if (note.parent_id && noteMap.has(note.parent_id)) {
              const parent = noteMap.get(note.parent_id);
              parent?.children.push(noteWithChildren);
            } else {
              rootNotes.push(noteWithChildren);
            }
          }
        });

        set({ notes: rootNotes });
        set({ 
          title: firstProject.title,
          projects: [firstProject]
        });
      } else {
        // Create new project if none exist
        const { data: newProject } = await supabase
          .from('settings')
          .insert({
            user_id: userData.user.id,
            title: 'New Project',
            description: ''
          })
          .select()
          .single();

        if (newProject) {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('project', newProject.id);
          window.history.replaceState({}, '', newUrl.toString());
          await get().switchProject(newProject.id);
        }
      }
    }
  },

  copyProject: async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    try {
      // Get source project
      const { data: sourceProject } = await supabase
        .from('settings')
        .select('*')
        .eq('id', id)
        .single();

      if (!sourceProject) {
        throw new Error('Source project not found');
      }

      // Generate unique title for the copy
      const uniqueTitle = await getUniqueTitle(userData.user.id, `${sourceProject.title} (Copy)`);

      // Create new project
      const { data: newProject, error: projectError } = await supabase
        .from('settings')
        .insert({
          user_id: userData.user.id,
          title: uniqueTitle,
          description: sourceProject.description
        })
        .select()
        .single();

      if (projectError || !newProject) {
        throw new Error('Failed to create new project');
      }

      // Get notes from source project
      const { data: sourceNotes, error: notesError } = await supabase
        .from('notes')
        .select(`
          *,
          images:note_images(*)
        `)
        .eq('project_id', id)
        .order('position');

      if (notesError) {
        throw new Error('Failed to fetch source notes');
      }

      if (!sourceNotes || sourceNotes.length === 0) {
        // No notes to copy, just switch to the new project
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('project', newProject.id);
        window.history.replaceState({}, '', newUrl.toString());
        await get().switchProject(newProject.id);
        return;
      }

      // Create map of old note IDs to new note IDs
      const idMap = new Map<string, string>();
      
      // First pass: create all notes with new IDs
      for (const note of sourceNotes) {
        const newId = generateId();
        idMap.set(note.id, newId);
        
        await supabase
          .from('notes')
          .insert({
            id: newId,
            content: note.content,
            parent_id: null, // Will update in second pass
            user_id: userData.user.id,
            project_id: newProject.id,
            position: note.position,
            is_discussion: note.is_discussion
          });
      }

      // Second pass: update parent_id references
      for (const note of sourceNotes) {
        if (note.parent_id) {
          const newParentId = idMap.get(note.parent_id);
          if (newParentId) {
            await supabase
              .from('notes')
              .update({ parent_id: newParentId })
              .eq('id', idMap.get(note.id));
          }
        }
      }

      // Copy images
      for (const note of sourceNotes) {
        if (note.images && note.images.length > 0) {
          for (const image of note.images) {
            await supabase
              .from('note_images')
              .insert({
                note_id: idMap.get(note.id),
                url: image.url,
                storage_path: image.storage_path,
                position: image.position
              });
          }
        }
      }

      // Update URL and switch to the new project
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('project', newProject.id);
      window.history.replaceState({}, '', newUrl.toString());
      await get().switchProject(newProject.id);
    } catch (error) {
      console.error('Error copying project:', error);
      throw error;
    }
  },
}
)
)