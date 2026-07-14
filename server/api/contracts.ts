export const READ_LIMITS = {
  about: 3,
  currentOccupation: 1,
  hobbies: 10,
  languages: 3,
  pageCards: 10,
  professionalTimeline: 10,
  projectsAndCases: 50,
  pursuit: 1,
  socialmedia: 10,
} as const;

export const SERVICE_UNAVAILABLE = {
  errorMessage: 'Service temporarily unavailable',
  success: false,
} as const;
