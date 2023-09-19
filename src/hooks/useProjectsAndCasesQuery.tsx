import axios from 'axios';
import { useQuery } from 'react-query';
import { ProjectsAndCases } from 'src/types/DBTypes';

const getProjectsAndCases = () =>
  axios
    .get<ProjectsAndCases[]>(`/api/projectsAndCases`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch((err: unknown) => console.log(err));

const useProjectsAndCasesQuery = () => {
  return useQuery(['getProjectsAndCases'], () => getProjectsAndCases());
};

export default useProjectsAndCasesQuery;
