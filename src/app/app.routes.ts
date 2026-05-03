import { Routes } from '@angular/router';
import { DownloadsComponent } from './pages/downloads/downloads.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: DownloadsComponent },
  { path: '**', redirectTo: '' },
];
