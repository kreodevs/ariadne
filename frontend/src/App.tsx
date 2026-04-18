/**
 * @fileoverview App principal: rutas y layout. Auth OTP, repos, chat, credenciales.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
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
import { ErrorPage } from './pages/ErrorPage';
import { ComponentGraphExplorer } from './pages/ComponentGraph';
import { DomainsList } from './pages/DomainsList';

/** Componente raíz con enrutamiento. */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route
          path="*"
          element={
            <Layout>
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
                  <Route path="/graph-explorer" element={<ComponentGraphExplorer />} />
                  <Route path="/domains" element={<DomainsList />} />
                  <Route path="/ayuda/*" element={<Ayuda />} />
                </Routes>
              </ProtectedRoute>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
