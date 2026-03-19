/**
 * @fileoverview App principal: rutas y layout. Repos, chat, credenciales. SSO opcional.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProjectList } from './pages/ProjectList';
import { ProjectDetail } from './pages/ProjectDetail';
import { ProjectChat } from './pages/ProjectChat';
import { CreateProject } from './pages/CreateProject';
import { RepoList } from './pages/RepoList';
import { RepoDetail } from './pages/RepoDetail';
import { RepoChat } from './pages/RepoChat';
import { RepoIndex } from './pages/RepoIndex';
import { CreateRepo } from './pages/CreateRepo';
import { EditRepo } from './pages/EditRepo';
import { CredentialsList } from './pages/CredentialsList';
import { CreateCredential } from './pages/CreateCredential';
import { EditCredential } from './pages/EditCredential';
import { Ayuda } from './pages/Ayuda';
import { Callback } from './pages/Callback';
import { ErrorPage } from './pages/ErrorPage';

/** Componente raíz con enrutamiento. */
function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/callback" element={<Callback />} />
          <Route path="/error" element={<ErrorPage />} />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <Routes>
                  <Route path="/" element={<ProjectList />} />
                  <Route path="/projects/new" element={<CreateProject />} />
                  <Route path="/projects/:id/chat" element={<ProjectChat />} />
                  <Route path="/projects/:id" element={<ProjectDetail />} />
                  <Route path="/repos" element={<RepoList />} />
                  <Route path="/repos/new" element={<CreateRepo />} />
                  <Route path="/repos/:id/edit" element={<EditRepo />} />
                  <Route path="/repos/:id/chat" element={<RepoChat />} />
                  <Route path="/repos/:id/index" element={<RepoIndex />} />
                  <Route path="/repos/:id" element={<RepoDetail />} />
                  <Route path="/credentials" element={<CredentialsList />} />
                  <Route path="/credentials/new" element={<CreateCredential />} />
                  <Route path="/credentials/:id/edit" element={<EditCredential />} />
                  <Route path="/ayuda/*" element={<Ayuda />} />
                </Routes>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
