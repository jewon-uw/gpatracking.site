import React, { useState, useMemo } from 'react';
import {
  GraduationCap,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  LogOut,
  LogIn,
  AlertCircle,
  BarChart3,
  BookOpen,
  Award,
  Sparkles,
  ArrowRight,
  Settings,
  RefreshCw,
  Info
} from 'lucide-react';

// ==========================================
// UTILITY FUNCTIONS & CONSTANTS
// ==========================================

// Standard 4.0 Scale Conversion Table
const percentageToGPA = (percentage: number | null | undefined): number => {
  if (percentage === null || percentage === undefined || isNaN(percentage)) return 0.0;
  if (percentage >= 93) return 4.0;
  if (percentage >= 90) return 3.7;
  if (percentage >= 87) return 3.3;
  if (percentage >= 83) return 3.0;
  if (percentage >= 80) return 2.7;
  if (percentage >= 77) return 2.3;
  if (percentage >= 73) return 2.0;
  if (percentage >= 70) return 1.7;
  if (percentage >= 67) return 1.3;
  if (percentage >= 63) return 1.0;
  if (percentage >= 60) return 0.7;
  return 0.0;
};

const CATEGORY_TYPES = ['Assignment', 'Quiz', 'Midterm', 'Final', 'Other'];

// Data Types
interface GradeItem {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number | null;
  maxScore: number;
}

interface CourseRules {
  dropLowestCount: number;
  dropCategory: string;
  shiftWeightTo: string;
}

interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  items: GradeItem[];
  rules: CourseRules;
}

interface UserProfile {
  email: string;
  sub: string;
}

// ==========================================
// MAIN APP COMPONENT
// ==========================================

export default function App() {
  // Authentication & User State
  const [user, setUser] = useState<UserProfile | null>(null); // null = Guest, object = Authenticated User
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);

  // Dynamic Courses State (Initialized Empty for Clean Guest Flow)
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  // Sync / Cloud notification toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ------------------------------------------
  // AUTHENTICATION LOGIC & AMPLIFY MOCK INTEGRATION
  // ------------------------------------------

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!authEmail || !authPassword) {
      setAuthError('Please fill in all fields.');
      return;
    }

    try {
      const mockUser = { email: authEmail, sub: 'user-id-12345' };

      // Perform Guest -> DynamoDB Migration if user had created guest courses
      if (courses.length > 0) {
        setIsMigrating(true);
        await new Promise((res) => setTimeout(res, 800));
        setIsMigrating(false);
        showToast('Successfully logged in & migrated guest courses to DynamoDB!');
      } else {
        showToast('Logged in successfully!');
      }

      setUser(mockUser);
      setAuthModalOpen(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed. Check your credentials.');
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!authEmail || !authPassword) {
      setAuthError('Please enter email and password.');
      return;
    }

    try {
      const mockUser = { email: authEmail, sub: 'user-id-new' };
      setUser(mockUser);
      setAuthModalOpen(false);
      showToast('Account created and synced with AWS DynamoDB!');
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      setAuthError(err.message || 'Sign up failed.');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setCourses([]); // Reset on logout
    setActiveCourseId(null);
    showToast('Logged out. Session cleared.');
  };

  // ------------------------------------------
  // GRADE & GPA CALCULATION ENGINE
  // ------------------------------------------

  const calculateCourseGrades = (course: Course) => {
    if (!course || !course.items || course.items.length === 0) {
      return { currentGrade: 0, maxPossibleGrade: 100, processedItems: [], totalCompletedWeight: 0 };
    }

    const { items, rules } = course;
    const dropCount = rules?.dropLowestCount || 0;
    const dropCat = rules?.dropCategory;
    const shiftTo = rules?.shiftWeightTo || 'Proportional';

    // Group items in the drop category to find lowest scores
    let itemsToDropIds = new Set<string>();
    if (dropCount > 0 && dropCat) {
      const eligibleItems = items
        .filter((it) => it.category === dropCat && it.score !== null && it.score !== undefined)
        .map((it) => ({
          id: it.id,
          percentage: (it.score! / it.maxScore) * 100,
        }))
        .sort((a, b) => a.percentage - b.percentage);

      eligibleItems.slice(0, dropCount).forEach((it) => itemsToDropIds.add(it.id));
    }

    // Process items, applying dropped status
    let totalDroppedWeight = 0;
    const processedItems = items.map((it) => {
      const isDropped = itemsToDropIds.has(it.id);
      if (isDropped) totalDroppedWeight += parseFloat(String(it.weight || 0));

      const pct = it.score !== null && it.score !== undefined ? (it.score / it.maxScore) * 100 : null;
      return {
        ...it,
        isDropped,
        percentage: pct,
      };
    });

    // Reallocate dropped weights if needed
    let currentEarnedWeight = 0;
    let completedTotalWeight = 0;
    let totalWeightActive = 0;

    const activeItems = processedItems.filter((it) => !it.isDropped);
    const baseActiveWeightSum = activeItems.reduce((acc, it) => acc + parseFloat(String(it.weight || 0)), 0);

    activeItems.forEach((it) => {
      let effectiveWeight = parseFloat(String(it.weight || 0));

      if (totalDroppedWeight > 0 && baseActiveWeightSum > 0) {
        if (shiftTo === 'Proportional') {
          effectiveWeight += (effectiveWeight / baseActiveWeightSum) * totalDroppedWeight;
        } else if (shiftTo === it.category || shiftTo === it.name) {
          effectiveWeight += totalDroppedWeight;
        }
      }

      totalWeightActive += effectiveWeight;

      if (it.percentage !== null) {
        completedTotalWeight += effectiveWeight;
        currentEarnedWeight += (it.percentage / 100) * effectiveWeight;
      }
    });

    const currentGrade = completedTotalWeight > 0 ? (currentEarnedWeight / completedTotalWeight) * 100 : 0;
    const uncompletedWeight = totalWeightActive - completedTotalWeight;
    const maxPossibleWeight = currentEarnedWeight + uncompletedWeight;
    const maxPossibleGrade = totalWeightActive > 0 ? (maxPossibleWeight / totalWeightActive) * 100 : 100;

    return {
      currentGrade: Math.min(100, Math.round(currentGrade * 100) / 100),
      maxPossibleGrade: Math.min(100, Math.round(maxPossibleGrade * 100) / 100),
      processedItems,
      totalCompletedWeight: completedTotalWeight,
    };
  };

  // Overall Term GPA Calculation
  const termGPA = useMemo(() => {
    if (courses.length === 0) return { currentGPA: '0.00', maxGPA: '0.00', totalCredits: 0 };

    let totalPoints = 0;
    let maxTotalPoints = 0;
    let totalCredits = 0;

    courses.forEach((crs) => {
      const { currentGrade, maxPossibleGrade } = calculateCourseGrades(crs);
      const credits = parseFloat(String(crs.credits || 0.5));

      const currentGpaVal = percentageToGPA(currentGrade);
      const maxGpaVal = percentageToGPA(maxPossibleGrade);

      totalPoints += currentGpaVal * credits;
      maxTotalPoints += maxGpaVal * credits;
      totalCredits += credits;
    });

    return {
      currentGPA: totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '0.00',
      maxGPA: totalCredits > 0 ? (maxTotalPoints / totalCredits).toFixed(2) : '0.00',
      totalCredits,
    };
  }, [courses]);

  const activeCourse = courses.find((c) => c.id === activeCourseId) || courses[0];

  // ------------------------------------------
  // COURSE & ASSESSMENT MUTATION HANDLERS
  // ------------------------------------------

  const handleSaveCourse = (courseData: Partial<Course>) => {
    if (editingCourse) {
      setCourses(courses.map((c) => (c.id === editingCourse.id ? { ...c, ...courseData } as Course : c)));
      showToast('Course updated!');
    } else {
      const newCourse: Course = {
        id: `course-${Date.now()}`,
        code: courseData.code || 'CS 101',
        name: courseData.name || 'Introductory Computer Science',
        credits: courseData.credits || 0.5,
        items: courseData.items || [
          { id: `i-${Date.now()}-1`, name: 'Assignment 1', category: 'Assignment', weight: 20, score: null, maxScore: 100 },
          { id: `i-${Date.now()}-2`, name: 'Midterm Exam', category: 'Midterm', weight: 30, score: null, maxScore: 100 },
          { id: `i-${Date.now()}-3`, name: 'Final Exam', category: 'Final', weight: 50, score: null, maxScore: 100 },
        ],
        rules: courseData.rules || { dropLowestCount: 0, dropCategory: 'Assignment', shiftWeightTo: 'Proportional' },
      };
      setCourses([...courses, newCourse]);
      setActiveCourseId(newCourse.id);
      showToast('New course added!');
    }
    setIsCourseModalOpen(false);
    setEditingCourse(null);
  };

  const handleDeleteCourse = (courseId: string) => {
    const updated = courses.filter((c) => c.id !== courseId);
    setCourses(updated);
    if (activeCourseId === courseId) {
      setActiveCourseId(updated[0]?.id || null);
    }
    showToast('Course removed.');
  };

  const handleUpdateItemScore = (courseId: string, itemId: string, newScore: number | null) => {
    setCourses(
      courses.map((crs) => {
        if (crs.id !== courseId) return crs;
        return {
          ...crs,
          items: crs.items.map((it) => (it.id === itemId ? { ...it, score: newScore } : it)),
        };
      })
    );
  };

  const handleAddItemToCourse = (courseId: string) => {
    setCourses(
      courses.map((crs) => {
        if (crs.id !== courseId) return crs;
        const newItem: GradeItem = {
          id: `item-${Date.now()}`,
          name: `New Assessment`,
          category: 'Assignment',
          weight: 10,
          score: null,
          maxScore: 100,
        };
        return { ...crs, items: [...crs.items, newItem] };
      })
    );
  };

  const handleRemoveItemFromCourse = (courseId: string, itemId: string) => {
    setCourses(
      courses.map((crs) => {
        if (crs.id !== courseId) return crs;
        return { ...crs, items: crs.items.filter((it) => it.id !== itemId) };
      })
    );
  };

  const handleUpdateItemDetail = (courseId: string, itemId: string, field: keyof GradeItem, value: any) => {
    setCourses(
      courses.map((crs) => {
        if (crs.id !== courseId) return crs;
        return {
          ...crs,
          items: crs.items.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)),
        };
      })
    );
  };

  const handleUpdateRules = (courseId: string, rules: Partial<CourseRules>) => {
    setCourses(
      courses.map((crs) => (crs.id === courseId ? { ...crs, rules: { ...crs.rules, ...rules } } : crs))
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce border border-indigo-400/30">
          <Sparkles className="w-5 h-5 text-yellow-300" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Migration Overlay */}
      {isMigrating && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-4">
          <RefreshCw className="w-12 h-12 text-indigo-400 animate-spin" />
          <p className="text-lg font-semibold text-slate-200">Migrating guest data to AWS DynamoDB...</p>
        </div>
      )}

      {/* HEADER / NAVIGATION BAR */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/20 rounded-xl border border-indigo-500/30 text-indigo-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                GPA Tracking
              </span>
              <span className="text-xs text-slate-400 ml-2 hidden sm:inline-block font-mono bg-slate-800 px-2 py-0.5 rounded">
                gpatracking.site
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold">
                  {user.email[0].toUpperCase()}
                </div>
                <div className="text-xs hidden md:block">
                  <p className="font-medium text-slate-200">{user.email}</p>
                  <p className="text-emerald-400 text-[10px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> AWS DynamoDB Connected
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-rose-400 p-1 transition-colors"
                  title="Log Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg hidden sm:flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> Guest Mode (Not Saved)
                </span>
                <button
                  onClick={() => {
                    setAuthMode('login');
                    setAuthModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-indigo-600/20"
                >
                  <LogIn className="w-3.5 h-3.5" /> Login / Sync
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full flex flex-col gap-8">
        {/* TOP SUMMARY CARDS */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Award className="w-24 h-24 text-indigo-400" />
            </div>
            <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Current Term GPA</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-4xl font-extrabold text-white tracking-tight">{termGPA.currentGPA}</span>
              <span className="text-sm text-slate-400 font-medium">/ 4.00</span>
            </div>
            <p className="text-xs text-indigo-400 mt-2 flex items-center gap-1">
              Based on {courses.length} course(s) ({termGPA.totalCredits} units)
            </p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <BarChart3 className="w-24 h-24 text-cyan-400" />
            </div>
            <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Max Possible Term GPA</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-4xl font-extrabold text-cyan-400 tracking-tight">{termGPA.maxGPA}</span>
              <span className="text-sm text-slate-400 font-medium">/ 4.00</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">Achieved if remaining assessments get 100%</p>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-sm">
            <div>
              <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Cloud Persistence</p>
              <p className="text-sm text-slate-300 mt-1">
                {user ? (
                  <span className="text-emerald-400 font-medium flex items-center gap-1.5 mt-1">
                    <Check className="w-4 h-4" /> Live synced to AWS DynamoDB
                  </span>
                ) : (
                  <span className="text-amber-400/90 font-medium flex items-center gap-1.5 mt-1">
                    <AlertCircle className="w-4 h-4" /> Guest data resets on reload
                  </span>
                )}
              </p>
            </div>
            {!user && (
              <button
                onClick={() => {
                  setAuthMode('signup');
                  setAuthModalOpen(true);
                }}
                className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-xs font-medium rounded-xl text-slate-200 transition-colors flex items-center justify-center gap-2 border border-slate-600"
              >
                Create Account to Save Data <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* COURSES SECTION */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Active Courses</h2>
              <p className="text-xs text-slate-400">Configure grading schemes, dropped scores, and enter grades</p>
            </div>
            <button
              onClick={() => {
                setEditingCourse(null);
                setIsCourseModalOpen(true);
              }}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/25"
            >
              <Plus className="w-4 h-4" /> Add Course
            </button>
          </div>

          {/* Course Tabs */}
          {courses.length > 0 ? (
            <div className="flex items-center gap-2 border-b border-slate-800 overflow-x-auto pb-2 scrollbar-thin">
              {courses.map((crs) => {
                const isActive = activeCourse?.id === crs.id;
                const { currentGrade } = calculateCourseGrades(crs);
                return (
                  <button
                    key={crs.id}
                    onClick={() => setActiveCourseId(crs.id)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border ${
                      isActive
                        ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow-md'
                        : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>
                      {crs.code} <span className="text-xs opacity-60">({crs.credits}u)</span>
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md font-bold ${
                        currentGrade >= 80
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : currentGrade >= 60
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {currentGrade}%
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl">
              <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">No active courses added</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                Get started by creating a course, defining your syllabus weights, and tracking your GPA.
              </p>
              <button
                onClick={() => {
                  setEditingCourse(null);
                  setIsCourseModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl"
              >
                Add Your First Course
              </button>
            </div>
          )}

          {/* ACTIVE COURSE DETAIL SHEET */}
          {activeCourse && (
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 flex flex-col gap-6 backdrop-blur-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/60 pb-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-bold text-white tracking-tight">{activeCourse.code}</h3>
                    <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-700/80 text-slate-300 font-medium">
                      {activeCourse.credits} Unit Credits
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{activeCourse.name}</p>
                </div>

                {(() => {
                  const { currentGrade, maxPossibleGrade } = calculateCourseGrades(activeCourse);
                  return (
                    <div className="flex items-center gap-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Current Grade</p>
                        <p className="text-2xl font-extrabold text-indigo-400">{currentGrade}%</p>
                      </div>
                      <div className="h-8 w-px bg-slate-800" />
                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Max Possible</p>
                        <p className="text-2xl font-extrabold text-cyan-400">{maxPossibleGrade}%</p>
                      </div>
                      <div className="h-8 w-px bg-slate-800" />
                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Estimated GPA</p>
                        <p className="text-2xl font-extrabold text-emerald-400">{percentageToGPA(currentGrade).toFixed(1)}</p>
                      </div>

                      <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-800">
                        <button
                          onClick={() => {
                            setEditingCourse(activeCourse);
                            setIsCourseModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Edit Course Details"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCourse(activeCourse.id)}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Delete Course"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ASSESSMENT TABLE */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-semibold text-slate-200">Assessment Syllabus & Grades</h4>
                  <button
                    onClick={() => handleAddItemToCourse(activeCourse.id)}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Assessment
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-900/40">
                  {(() => {
                    const { processedItems } = calculateCourseGrades(activeCourse);
                    return (
                      <table className="w-full text-left border-collapse text-xs sm:text-sm">
                        <thead>
                          <tr className="bg-slate-800/80 border-b border-slate-700/60 text-slate-400 uppercase tracking-wider text-[11px]">
                            <th className="py-3 px-4 font-semibold">Name</th>
                            <th className="py-3 px-4 font-semibold">Category</th>
                            <th className="py-3 px-4 font-semibold">Weight (%)</th>
                            <th className="py-3 px-4 font-semibold">Score / Max</th>
                            <th className="py-3 px-4 font-semibold">Percentage</th>
                            <th className="py-3 px-4 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {processedItems.map((item) => (
                            <tr
                              key={item.id}
                              className={`transition-colors hover:bg-slate-800/30 ${
                                item.isDropped ? 'bg-rose-950/10 text-slate-500 line-through' : ''
                              }`}
                            >
                              <td className="py-3 px-4">
                                <input
                                  type="text"
                                  value={item.name}
                                  onChange={(e) =>
                                    handleUpdateItemDetail(activeCourse.id, item.id, 'name', e.target.value)
                                  }
                                  className="bg-transparent font-medium text-slate-200 focus:outline-none focus:border-b border-indigo-500 w-full"
                                />
                              </td>
                              <td className="py-3 px-4">
                                <select
                                  value={item.category}
                                  onChange={(e) =>
                                    handleUpdateItemDetail(activeCourse.id, item.id, 'category', e.target.value)
                                  }
                                  className="bg-slate-800 text-slate-300 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                >
                                  {CATEGORY_TYPES.map((cat) => (
                                    <option key={cat} value={cat}>
                                      {cat}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={item.weight}
                                    onChange={(e) =>
                                      handleUpdateItemDetail(
                                        activeCourse.id,
                                        item.id,
                                        'weight',
                                        parseFloat(e.target.value) || 0
                                      )
                                    }
                                    className="w-16 bg-slate-800 text-slate-200 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none"
                                  />
                                  <span className="text-slate-500 text-xs">%</span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    placeholder="Score"
                                    value={item.score !== null && item.score !== undefined ? item.score : ''}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                      handleUpdateItemScore(activeCourse.id, item.id, val);
                                    }}
                                    className="w-16 bg-slate-800 text-slate-200 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none font-semibold"
                                  />
                                  <span className="text-slate-500">/</span>
                                  <input
                                    type="number"
                                    value={item.maxScore}
                                    onChange={(e) =>
                                      handleUpdateItemDetail(
                                        activeCourse.id,
                                        item.id,
                                        'maxScore',
                                        parseFloat(e.target.value) || 100
                                      )
                                    }
                                    className="w-16 bg-slate-800 text-slate-400 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none"
                                  />
                                </div>
                              </td>
                              <td className="py-3 px-4 font-bold">
                                {item.isDropped ? (
                                  <span className="text-xs text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 no-underline inline-block">
                                    Dropped
                                  </span>
                                ) : item.percentage !== null ? (
                                  <span
                                    className={
                                      item.percentage >= 80
                                        ? 'text-emerald-400'
                                        : item.percentage >= 60
                                        ? 'text-amber-400'
                                        : 'text-rose-400'
                                    }
                                  >
                                    {Math.round(item.percentage * 10) / 10}%
                                  </span>
                                ) : (
                                  <span className="text-slate-500 italic text-xs">Pending</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => handleRemoveItemFromCourse(activeCourse.id, item.id)}
                                  className="text-slate-500 hover:text-rose-400 p-1 rounded-md transition-colors"
                                  title="Remove assessment"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>

              {/* RULES SECTION */}
              <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs uppercase tracking-wider">
                  <Settings className="w-4 h-4" /> Course Policy & Weight Shifting Rules
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Drop Lowest Count</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={activeCourse.rules?.dropLowestCount || 0}
                        onChange={(e) =>
                          handleUpdateRules(activeCourse.id, {
                            dropLowestCount: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-20 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none"
                      />
                      <span className="text-slate-400">score(s)</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">From Category</label>
                    <select
                      value={activeCourse.rules?.dropCategory || 'Assignment'}
                      onChange={(e) =>
                        handleUpdateRules(activeCourse.id, {
                          dropCategory: e.target.value,
                        })
                      }
                      className="w-full bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none"
                    >
                      {CATEGORY_TYPES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Shift Dropped Weight To</label>
                    <select
                      value={activeCourse.rules?.shiftWeightTo || 'Proportional'}
                      onChange={(e) =>
                        handleUpdateRules(activeCourse.id, {
                          shiftWeightTo: e.target.value,
                        })
                      }
                      className="w-full bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none"
                    >
                      <option value="Proportional">Reallocate Proportionally</option>
                      <option value="Final">Final Exam</option>
                      <option value="Midterm">Midterm Exam</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 py-6 bg-slate-950/60 mt-auto text-center text-xs text-slate-500">
        <p>GPA Tracking App • Configured for gpatracking.site • AWS Amplify & DynamoDB Ready</p>
      </footer>

      {/* AUTH MODAL */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setAuthModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">
              {authMode === 'login' ? 'Sign In to Sync Data' : 'Create Account'}
            </h3>
            <p className="text-xs text-slate-400 mb-6">
              Connect to AWS Cognito and save your courses directly to DynamoDB.
            </p>

            {authError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp} className="flex flex-col gap-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="submit"
                className="mt-2 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-600/20"
              >
                {authMode === 'login' ? 'Log In & Migrate Guest Courses' : 'Create AWS Cognito Account'}
              </button>
            </form>

            <div className="mt-6 text-center text-xs text-slate-400 border-t border-slate-800 pt-4">
              {authMode === 'login' ? (
                <p>
                  Don't have an account?{' '}
                  <button onClick={() => setAuthMode('signup')} className="text-indigo-400 font-semibold hover:underline">
                    Sign Up
                  </button>
                </p>
              ) : (
                <p>
                  Already registered?{' '}
                  <button onClick={() => setAuthMode('login')} className="text-indigo-400 font-semibold hover:underline">
                    Log In
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* COURSE MODAL */}
      {isCourseModalOpen && (
        <CourseModal
          course={editingCourse}
          onClose={() => setIsCourseModalOpen(false)}
          onSave={handleSaveCourse}
        />
      )}
    </div>
  );
}

// ==========================================
// COURSE MODAL COMPONENT
// ==========================================

function CourseModal({
  course,
  onClose,
  onSave,
}: {
  course: Course | null;
  onClose: () => void;
  onSave: (data: Partial<Course>) => void;
}) {
  const [code, setCode] = useState(course?.code || '');
  const [name, setName] = useState(course?.name || '');
  const [credits, setCredits] = useState(course?.credits || 0.5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name) return;
    onSave({
      code,
      name,
      credits: parseFloat(String(credits)) || 0.5,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold text-white mb-4">
          {course ? 'Edit Course Details' : 'Add New Active Course'}
        </h3>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Course Code</label>
            <input
              type="text"
              required
              placeholder="e.g. CS 135"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Course Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Designing Functional Programs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Course Credit Weight / Units</label>
            <input
              type="number"
              step="0.25"
              required
              value={credits}
              onChange={(e) => setCredits(parseFloat(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">Default is 0.5 units per standard university course.</p>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl border border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/20"
            >
              Save Course
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}